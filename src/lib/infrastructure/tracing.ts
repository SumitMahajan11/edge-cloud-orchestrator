import { generateId } from '../utils'

interface TraceContext {
  traceId: string
  spanId: string
  parentSpanId?: string
  sampled: boolean
}

interface Span {
  id: string
  traceId: string
  parentId?: string
  name: string
  startTime: number
  endTime?: number
  duration?: number
  tags: Record<string, string>
  logs: SpanLog[]
  status: 'ok' | 'error'
}

interface SpanLog {
  timestamp: number
  fields: Record<string, unknown>
}

interface Trace {
  traceId: string
  spans: Span[]
  startTime: number
  endTime?: number
}

class Tracer {
  private spans: Map<string, Span> = new Map()
  private traces: Map<string, Trace> = new Map()
  private currentContext: TraceContext | null = null

  startTrace(name: string, parentContext?: TraceContext): TraceContext {
    const traceId = parentContext?.traceId ?? this.generateId()
    const spanId = this.generateId()

    const context: TraceContext = {
      traceId,
      spanId,
      parentSpanId: parentContext?.spanId,
      sampled: parentContext?.sampled ?? true,
    }

    if (context.sampled) {
      const span: Span = {
        id: spanId,
        traceId,
        parentId: parentContext?.spanId,
        name,
        startTime: Date.now(),
        tags: {},
        logs: [],
        status: 'ok',
      }

      this.spans.set(spanId, span)

      if (!parentContext) {
        this.traces.set(traceId, {
          traceId,
          spans: [span],
          startTime: Date.now(),
        })
      } else {
        const trace = this.traces.get(traceId)
        if (trace) {
          trace.spans.push(span)
        }
      }
    }

    this.currentContext = context
    return context
  }

  startSpan(name: string, parentContext?: TraceContext): TraceContext {
    return this.startTrace(name, parentContext ?? this.currentContext ?? undefined)
  }

  finishSpan(context: TraceContext): void {
    if (!context.sampled) return

    const span = this.spans.get(context.spanId)
    if (span) {
      span.endTime = Date.now()
      span.duration = span.endTime - span.startTime

      // Update trace end time
      const trace = this.traces.get(context.traceId)
      if (trace) {
        trace.endTime = Date.now()
      }
    }

    // Restore parent context
    if (context.parentSpanId) {
      const parentSpan = this.spans.get(context.parentSpanId)
      if (parentSpan) {
        this.currentContext = {
          traceId: context.traceId,
          spanId: parentSpan.id,
          parentSpanId: parentSpan.parentId,
          sampled: context.sampled,
        }
      }
    } else {
      this.currentContext = null
    }
  }

  addTag(context: TraceContext, key: string, value: string): void {
    if (!context.sampled) return

    const span = this.spans.get(context.spanId)
    if (span) {
      span.tags[key] = value
    }
  }

  addTags(context: TraceContext, tags: Record<string, string>): void {
    if (!context.sampled) return

    const span = this.spans.get(context.spanId)
    if (span) {
      Object.assign(span.tags, tags)
    }
  }

  log(context: TraceContext, fields: Record<string, unknown>): void {
    if (!context.sampled) return

    const span = this.spans.get(context.spanId)
    if (span) {
      span.logs.push({
        timestamp: Date.now(),
        fields,
      })
    }
  }

  setError(context: TraceContext, error: Error): void {
    if (!context.sampled) return

    const span = this.spans.get(context.spanId)
    if (span) {
      span.status = 'error'
      span.tags['error'] = 'true'
      span.tags['error.message'] = error.message
      span.tags['error.stack'] = error.stack ?? ''
    }
  }

  getTrace(traceId: string): Trace | undefined {
    return this.traces.get(traceId)
  }

  getSpan(spanId: string): Span | undefined {
    return this.spans.get(spanId)
  }

  getCurrentContext(): TraceContext | null {
    return this.currentContext
  }

  extractContext(headers: Record<string, string>): TraceContext | null {
    const traceId = headers['x-trace-id']
    const spanId = headers['x-span-id']
    const sampled = headers['x-trace-sampled'] !== 'false'

    if (!traceId) return null

    return {
      traceId,
      spanId: spanId ?? this.generateId(),
      sampled,
    }
  }

  injectContext(context: TraceContext): Record<string, string> {
    return {
      'x-trace-id': context.traceId,
      'x-span-id': context.spanId,
      'x-trace-sampled': context.sampled ? 'true' : 'false',
    }
  }

  private generateId(): string {
    return generateId()
  }

  // Export trace data
  exportTrace(traceId: string): Record<string, unknown> | null {
    const trace = this.traces.get(traceId)
    if (!trace) return null

    return {
      traceId: trace.traceId,
      duration: trace.endTime ? trace.endTime - trace.startTime : null,
      spans: trace.spans.map(span => ({
        id: span.id,
        name: span.name,
        duration: span.duration,
        tags: span.tags,
        logs: span.logs,
        status: span.status,
      })),
    }
  }

  // Clear old traces
  cleanup(maxAgeMs = 3600000): number {
    const cutoff = Date.now() - maxAgeMs
    let removed = 0

    for (const [traceId, trace] of this.traces) {
      if (trace.startTime < cutoff) {
        // Remove all spans for this trace
        trace.spans.forEach(span => this.spans.delete(span.id))
        this.traces.delete(traceId)
        removed++
      }
    }

    return removed
  }
}

// Correlation ID manager
class CorrelationManager {
  private correlationId: string | null = null

  set(id: string): void {
    this.correlationId = id
  }

  get(): string {
    if (!this.correlationId) {
      this.correlationId = generateId()
    }
    return this.correlationId
  }

  clear(): void {
    this.correlationId = null
  }

  // Middleware for Express
  middleware() {
    return (req: { headers: Record<string, string> }, res: { setHeader: (key: string, value: string) => void }, next: () => void) => {
      // Extract or generate correlation ID
      const correlationId = req.headers['x-correlation-id'] ?? generateId()
      this.set(correlationId as string)

      // Add to response headers
      res.setHeader('x-correlation-id', correlationId)

      next()
    }
  }
}

// Request timing helper
class RequestTimer {
  private startTime: number | null = null

  start(): void {
    this.startTime = performance.now()
  }

  elapsed(): number {
    if (this.startTime === null) return 0
    return performance.now() - this.startTime
  }

  reset(): void {
    this.startTime = null
  }
}

// Singleton instances
export const tracer = new Tracer()
export const correlationManager = new CorrelationManager()

export { Tracer, CorrelationManager, RequestTimer }
export type { TraceContext, Span, SpanLog, Trace }
