interface SpanContext {
  traceId: string
  spanId: string
  parentSpanId?: string
  sampled: boolean
  baggage: Record<string, string>
}

interface Span {
  context: SpanContext
  operationName: string
  startTime: number
  duration: number
  tags: Record<string, unknown>
  logs: Array<{ timestamp: number; fields: Record<string, unknown> }>
  references: Array<{ type: 'child_of' | 'follows_from'; context: SpanContext }>
}

interface JaegerConfig {
  serviceName: string
  agentHost?: string
  agentPort?: number
  flushIntervalMs?: number
  maxQueueSize?: number
}

class JaegerTracer {
  private config: Required<JaegerConfig>
  private spans: Span[] = []
  private currentSpan: Map<string, Span> = new Map()
  private flushInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: JaegerConfig) {
    this.config = {
      agentHost: 'localhost',
      agentPort: 6832,
      flushIntervalMs: 1000,
      maxQueueSize: 1000,
      ...config,
    }
    this.startFlushInterval()
  }

  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.flush()
    }, this.config.flushIntervalMs)
  }

  private generateId(): string {
    return Math.random().toString(16).substring(2) + Date.now().toString(16)
  }

  startSpan(
    operationName: string,
    options?: {
      childOf?: SpanContext
      references?: Array<{ type: 'child_of' | 'follows_from'; context: SpanContext }>
      tags?: Record<string, unknown>
    }
  ): SpanContext {
    const traceId = options?.childOf?.traceId ?? this.generateId()
    const spanId = this.generateId()

    const context: SpanContext = {
      traceId,
      spanId,
      parentSpanId: options?.childOf?.spanId,
      sampled: options?.childOf?.sampled ?? true,
      baggage: options?.childOf?.baggage ?? {},
    }

    const span: Span = {
      context,
      operationName,
      startTime: Date.now() * 1000, // Microseconds
      duration: 0,
      tags: {
        'service.name': this.config.serviceName,
        ...options?.tags,
      },
      logs: [],
      references: options?.references ?? [],
    }

    if (options?.childOf) {
      span.references.push({ type: 'child_of', context: options.childOf })
    }

    this.currentSpan.set(spanId, span)

    return context
  }

  finishSpan(spanId: string, tags?: Record<string, unknown>): void {
    const span = this.currentSpan.get(spanId)
    if (!span) return

    span.duration = Date.now() * 1000 - span.startTime

    if (tags) {
      span.tags = { ...span.tags, ...tags }
    }

    this.currentSpan.delete(spanId)

    // Add to queue
    this.spans.push(span)

    // Flush if queue is full
    if (this.spans.length >= this.config.maxQueueSize) {
      this.flush()
    }
  }

  log(spanId: string, fields: Record<string, unknown>): void {
    const span = this.currentSpan.get(spanId)
    if (!span) return

    span.logs.push({
      timestamp: Date.now() * 1000,
      fields,
    })
  }

  setTag(spanId: string, key: string, value: unknown): void {
    const span = this.currentSpan.get(spanId)
    if (!span) return

    span.tags[key] = value
  }

  inject(context: SpanContext, format: 'http' | 'text_map', carrier: Record<string, string>): void {
    switch (format) {
      case 'http':
      case 'text_map':
        carrier['uber-trace-id'] = `${context.traceId}:${context.spanId}:${context.parentSpanId ?? '0'}:${context.sampled ? '1' : '0'}`
        Object.entries(context.baggage).forEach(([key, value]) => {
          carrier[`uberctx-${key}`] = value
        })
        break
    }
  }

  extract(format: 'http' | 'text_map', carrier: Record<string, string>): SpanContext | null {
    switch (format) {
      case 'http':
      case 'text_map': {
        const traceId = carrier['uber-trace-id']
        if (!traceId) return null

        const parts = traceId.split(':')
        if (parts.length !== 4) return null

        const baggage: Record<string, string> = {}
        Object.entries(carrier).forEach(([key, value]) => {
          if (key.startsWith('uberctx-')) {
            baggage[key.substring(8)] = value
          }
        })

        return {
          traceId: parts[0],
          spanId: parts[1],
          parentSpanId: parts[2] !== '0' ? parts[2] : undefined,
          sampled: parts[3] === '1',
          baggage,
        }
      }
      default:
        return null
    }
  }

  private flush(): void {
    if (this.spans.length === 0) return

    const batch = [...this.spans]
    this.spans = []

    // Send to Jaeger agent via UDP (Thrift compact protocol)
    // In browser environment, we'll use HTTP instead
    this.sendSpans(batch).catch(console.error)
  }

  private async sendSpans(spans: Span[]): Promise<void> {
    // Convert to Jaeger Thrift format
    const payload = {
      process: {
        serviceName: this.config.serviceName,
        tags: [],
      },
      spans: spans.map(span => ({
        traceIdLow: this.parseTraceId(span.context.traceId).low,
        traceIdHigh: this.parseTraceId(span.context.traceId).high,
        spanId: this.parseSpanId(span.context.spanId),
        parentSpanId: span.context.parentSpanId ? this.parseSpanId(span.context.parentSpanId) : 0,
        operationName: span.operationName,
        references: span.references.map(ref => ({
          refType: ref.type === 'child_of' ? 0 : 1,
          traceIdLow: this.parseTraceId(ref.context.traceId).low,
          traceIdHigh: this.parseTraceId(ref.context.traceId).high,
          spanId: this.parseSpanId(ref.context.spanId),
        })),
        flags: span.context.sampled ? 1 : 0,
        startTime: span.startTime,
        duration: span.duration,
        tags: Object.entries(span.tags).map(([key, value]) => ({
          key,
          vType: this.getTagType(value),
          vStr: typeof value === 'string' ? value : undefined,
          vBool: typeof value === 'boolean' ? value : undefined,
          vLong: typeof value === 'number' ? value : undefined,
        })),
        logs: span.logs.map(log => ({
          timestamp: log.timestamp,
          fields: Object.entries(log.fields).map(([key, value]) => ({
            key,
            vType: this.getTagType(value),
            vStr: typeof value === 'string' ? value : undefined,
          })),
        })),
      })),
    }

    // Send via HTTP to Jaeger collector
    try {
      await fetch(`http://${this.config.agentHost}:${this.config.agentPort}/api/traces`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
    } catch (error) {
      console.error('Failed to send spans to Jaeger:', error)
    }
  }

  private parseTraceId(traceId: string): { low: number; high: number } {
    // Simplified - in production use proper 128-bit parsing
    const num = parseInt(traceId.substring(0, 16), 16) || Date.now()
    return { low: num, high: 0 }
  }

  private parseSpanId(spanId: string): number {
    return parseInt(spanId.substring(0, 16), 16) || Date.now()
  }

  private getTagType(value: unknown): number {
    switch (typeof value) {
      case 'string':
        return 0 // STRING
      case 'boolean':
        return 1 // BOOL
      case 'number':
        return Number.isInteger(value) ? 2 : 3 // LONG : DOUBLE
      default:
        return 0
    }
  }

  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
    }
    this.flush()
  }
}

// Helper for automatic span creation around async functions
async function traceAsync<T>(
  tracer: JaegerTracer,
  operationName: string,
  fn: (span: SpanContext) => Promise<T>,
  parentContext?: SpanContext
): Promise<T> {
  const span = tracer.startSpan(operationName, { childOf: parentContext })

  try {
    const result = await fn(span)
    tracer.finishSpan(span.spanId, { 'span.status': 'ok' })
    return result
  } catch (error) {
    tracer.finishSpan(span.spanId, {
      'span.status': 'error',
      'error.message': error instanceof Error ? error.message : 'Unknown error',
    })
    throw error
  }
}

// Singleton instance
export const jaegerTracer = new JaegerTracer({
  serviceName: 'edge-cloud-orchestrator',
})

export { JaegerTracer, traceAsync }
export type { SpanContext, Span, JaegerConfig }
