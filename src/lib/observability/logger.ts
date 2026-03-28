/**
 * Enhanced Structured Logging for Edge-Cloud Orchestrator
 * Provides structured logging with tracing support
 */

// Types
export interface LogEntry {
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  context: Record<string, unknown>
  traceId?: string
  spanId?: string
  service: string
  version: string
  environment: string
}

export interface LoggerConfig {
  service: string
  version: string
  environment: string
  level: 'debug' | 'info' | 'warn' | 'error'
  includeTrace: boolean
  prettyPrint: boolean
  outputs: Array<'console' | 'file' | 'http'>
  httpEndpoint?: string
}

type LogEvent = 'log.created' | 'log.flushed'
type LogCallback = (event: LogEvent, data: unknown) => void

const DEFAULT_CONFIG: LoggerConfig = {
  service: 'edge-cloud-orchestrator',
  version: '1.0.0',
  environment: 'development',
  level: 'info',
  includeTrace: true,
  prettyPrint: true,
  outputs: ['console'],
}

const LOG_LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

/**
 * Tracing Context - Manages trace and span IDs
 */
export class TracingContext {
  private traceId: string | null = null
  private spanId: string | null = null
  private parentSpanId: string | null = null
  private baggage: Map<string, string> = new Map()

  /**
   * Start a new trace
   */
  startTrace(): string {
    this.traceId = this.generateId(32)
    this.spanId = this.generateId(16)
    this.parentSpanId = null
    return this.traceId
  }

  /**
   * Start a new span
   */
  startSpan(): string {
    if (this.traceId === null) {
      this.startTrace()
    }
    this.parentSpanId = this.spanId
    this.spanId = this.generateId(16)
    return this.spanId
  }

  /**
   * End current span
   */
  endSpan(): void {
    this.spanId = this.parentSpanId
  }

  /**
   * Set baggage item
   */
  setBaggage(key: string, value: string): void {
    this.baggage.set(key, value)
  }

  /**
   * Get baggage item
   */
  getBaggage(key: string): string | undefined {
    return this.baggage.get(key)
  }

  /**
   * Get current trace context
   */
  getContext(): { traceId: string | null; spanId: string | null; parentSpanId: string | null } {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
    }
  }

  /**
   * Set trace context from headers
   */
  setFromHeaders(headers: Record<string, string>): void {
    this.traceId = headers['x-trace-id'] || headers['traceparent']?.split('-')[1] || null
    this.spanId = headers['x-span-id'] || null
    this.parentSpanId = headers['x-parent-span-id'] || null
  }

  /**
   * Get trace headers for propagation
   */
  getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.traceId) headers['x-trace-id'] = this.traceId
    if (this.spanId) headers['x-span-id'] = this.spanId
    if (this.parentSpanId) headers['x-parent-span-id'] = this.parentSpanId
    return headers
  }

  /**
   * Clear context
   */
  clear(): void {
    this.traceId = null
    this.spanId = null
    this.parentSpanId = null
    this.baggage.clear()
  }

  private generateId(length: number): string {
    const bytes = new Uint8Array(length / 2)
    crypto.getRandomValues(bytes)
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  }
}

/**
 * Structured Logger
 */
export class StructuredLogger {
  private config: LoggerConfig
  private tracingContext: TracingContext
  private buffer: LogEntry[] = []
  private bufferSize = 100
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private callbacks: Map<LogEvent, Set<LogCallback>> = new Map()

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.tracingContext = new TracingContext()

    // Start flush timer for buffered logs
    if (this.config.outputs.includes('http')) {
      this.flushTimer = setInterval(() => this.flush(), 5000)
    }
  }

  /**
   * Set tracing context
   */
  setTracingContext(context: TracingContext): void {
    this.tracingContext = context
  }

  /**
   * Get tracing context
   */
  getTracingContext(): TracingContext {
    return this.tracingContext
  }

  /**
   * Log debug message
   */
  debug(message: string, context: Record<string, unknown> = {}): void {
    this.log('debug', message, context)
  }

  /**
   * Log info message
   */
  info(message: string, context: Record<string, unknown> = {}): void {
    this.log('info', message, context)
  }

  /**
   * Log warning message
   */
  warn(message: string, context: Record<string, unknown> = {}): void {
    this.log('warn', message, context)
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, context: Record<string, unknown> = {}): void {
    const errorContext = error ? {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      ...context,
    } : context

    this.log('error', message, errorContext)
  }

  /**
   * Create child logger with additional context
   */
  child(defaultContext: Record<string, unknown>): ChildLogger {
    return new ChildLogger(this, defaultContext)
  }

  /**
   * Start a trace
   */
  startTrace(name: string): string {
    const traceId = this.tracingContext.startTrace()
    this.debug(`Trace started: ${name}`, { traceId, operation: name })
    return traceId
  }

  /**
   * Start a span
   */
  startSpan(name: string): string {
    const spanId = this.tracingContext.startSpan()
    this.debug(`Span started: ${name}`, { spanId, operation: name })
    return spanId
  }

  /**
   * End current span
   */
  endSpan(name: string): void {
    this.debug(`Span ended: ${name}`)
    this.tracingContext.endSpan()
  }

  /**
   * Core logging method
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, context: Record<string, unknown>): void {
    // Check log level
    if (LOG_LEVELS[level] < LOG_LEVELS[this.config.level]) {
      return
    }

    const traceContext = this.tracingContext.getContext()
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      service: this.config.service,
      version: this.config.version,
      environment: this.config.environment,
    }

    if (this.config.includeTrace && traceContext.traceId) {
      entry.traceId = traceContext.traceId
      entry.spanId = traceContext.spanId || undefined
    }

    // Output to configured destinations
    for (const output of this.config.outputs) {
      switch (output) {
        case 'console':
          this.outputToConsole(entry)
          break
        case 'http':
          this.buffer.push(entry)
          if (this.buffer.length >= this.bufferSize) {
            this.flush()
          }
          break
      }
    }

    this.emit('log.created', entry)
  }

  /**
   * Output to console
   */
  private outputToConsole(entry: LogEntry): void {
    const output = this.config.prettyPrint 
      ? this.formatPretty(entry)
      : JSON.stringify(entry)

    switch (entry.level) {
      case 'debug':
        console.debug(output)
        break
      case 'info':
        console.info(output)
        break
      case 'warn':
        console.warn(output)
        break
      case 'error':
        console.error(output)
        break
    }
  }

  /**
   * Format log entry for pretty printing
   */
  private formatPretty(entry: LogEntry): string {
    const levelColors: Record<string, string> = {
      debug: '\x1b[36m', // Cyan
      info: '\x1b[32m',  // Green
      warn: '\x1b[33m',  // Yellow
      error: '\x1b[31m', // Red
    }
    const reset = '\x1b[0m'
    const dim = '\x1b[2m'

    const level = `${levelColors[entry.level]}${entry.level.toUpperCase().padEnd(5)}${reset}`
    const timestamp = `${dim}${entry.timestamp}${reset}`
    const trace = entry.traceId ? ` [${entry.traceId.slice(0, 8)}]` : ''
    
    let contextStr = ''
    if (Object.keys(entry.context).length > 0) {
      contextStr = ` ${JSON.stringify(entry.context)}`
    }

    return `${timestamp} ${level}${trace} ${entry.message}${contextStr}`
  }

  /**
   * Flush buffered logs to HTTP endpoint
   */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0 || !this.config.httpEndpoint) return

    const logs = [...this.buffer]
    this.buffer = []

    try {
      const response = await fetch(this.config.httpEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ logs }),
      })

      if (!response.ok) {
        // Re-buffer on failure
        this.buffer.unshift(...logs)
      }

      this.emit('log.flushed', { count: logs.length })
    } catch (error) {
      // Re-buffer on failure
      this.buffer.unshift(...logs)
      console.error('Failed to flush logs:', error)
    }
  }

  /**
   * Subscribe to events
   */
  on(event: LogEvent, callback: LogCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: LogEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        console.error('Logger callback error:', error)
      }
    })
  }

  /**
   * Shutdown logger
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
    }
    await this.flush()
  }
}

/**
 * Child Logger - Logger with default context
 */
export class ChildLogger {
  private parent: StructuredLogger
  private defaultContext: Record<string, unknown>

  constructor(parent: StructuredLogger, defaultContext: Record<string, unknown>) {
    this.parent = parent
    this.defaultContext = defaultContext
  }

  debug(message: string, context: Record<string, unknown> = {}): void {
    this.parent.debug(message, { ...this.defaultContext, ...context })
  }

  info(message: string, context: Record<string, unknown> = {}): void {
    this.parent.info(message, { ...this.defaultContext, ...context })
  }

  warn(message: string, context: Record<string, unknown> = {}): void {
    this.parent.warn(message, { ...this.defaultContext, ...context })
  }

  error(message: string, error?: Error, context: Record<string, unknown> = {}): void {
    this.parent.error(message, error, { ...this.defaultContext, ...context })
  }
}

/**
 * Log Aggregator - Aggregates logs from multiple sources
 */
export class LogAggregator {
  private logs: LogEntry[] = []
  private maxSize = 10000

  /**
   * Add log entry
   */
  add(entry: LogEntry): void {
    this.logs.push(entry)
    
    if (this.logs.length > this.maxSize) {
      this.logs = this.logs.slice(-this.maxSize)
    }
  }

  /**
   * Get logs by level
   */
  getByLevel(level: LogEntry['level']): LogEntry[] {
    return this.logs.filter(l => l.level === level)
  }

  /**
   * Get logs by trace ID
   */
  getByTraceId(traceId: string): LogEntry[] {
    return this.logs.filter(l => l.traceId === traceId)
  }

  /**
   * Get logs by time range
   */
  getByTimeRange(start: Date, end: Date): LogEntry[] {
    const startTime = start.getTime()
    const endTime = end.getTime()
    
    return this.logs.filter(l => {
      const logTime = new Date(l.timestamp).getTime()
      return logTime >= startTime && logTime <= endTime
    })
  }

  /**
   * Search logs
   */
  search(query: string): LogEntry[] {
    const lowerQuery = query.toLowerCase()
    return this.logs.filter(l => 
      l.message.toLowerCase().includes(lowerQuery) ||
      JSON.stringify(l.context).toLowerCase().includes(lowerQuery)
    )
  }

  /**
   * Get all logs
   */
  getAll(): LogEntry[] {
    return [...this.logs]
  }

  /**
   * Clear logs
   */
  clear(): void {
    this.logs = []
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number
    byLevel: Record<string, number>
    oldestTimestamp: string | null
    newestTimestamp: string | null
  } {
    const byLevel: Record<string, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
    }

    for (const log of this.logs) {
      byLevel[log.level]++
    }

    return {
      total: this.logs.length,
      byLevel,
      oldestTimestamp: this.logs[0]?.timestamp || null,
      newestTimestamp: this.logs[this.logs.length - 1]?.timestamp || null,
    }
  }
}

// Factory functions
export function createStructuredLogger(config: Partial<LoggerConfig> = {}): StructuredLogger {
  return new StructuredLogger(config)
}

export function createTracingContext(): TracingContext {
  return new TracingContext()
}

export function createLogAggregator(): LogAggregator {
  return new LogAggregator()
}

// Default instances
export const structuredLogger = new StructuredLogger()
export const tracingContext = new TracingContext()
export const logAggregator = new LogAggregator()

// Integration with existing logger
structuredLogger.on('log.created', (_, data) => {
  logAggregator.add(data as LogEntry)
})
