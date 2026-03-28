type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  context?: Record<string, unknown>
  error?: Error
}

interface LoggerConfig {
  minLevel?: LogLevel
  enableConsole?: boolean
  enableStorage?: boolean
  maxStorageEntries?: number
}

class Logger {
  private config: Required<LoggerConfig>
  private storage: LogEntry[] = []
  private listeners: Array<(entry: LogEntry) => void> = []

  constructor(config: LoggerConfig = {}) {
    this.config = {
      minLevel: 'info',
      enableConsole: true,
      enableStorage: true,
      maxStorageEntries: 1000,
      ...config,
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
    return levels.indexOf(level) >= levels.indexOf(this.config.minLevel)
  }

  private formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString()
    const contextStr = context ? ` ${JSON.stringify(context)}` : ''
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error): void {
    if (!this.shouldLog(level)) return

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      error,
    }

    // Console output
    if (this.config.enableConsole) {
      const formatted = this.formatMessage(level, message, context)
      switch (level) {
        case 'debug':
          console.debug(formatted)
          break
        case 'info':
          console.info(formatted)
          break
        case 'warn':
          console.warn(formatted)
          break
        case 'error':
          console.error(formatted, error)
          break
      }
    }

    // Storage
    if (this.config.enableStorage) {
      this.storage.push(entry)
      if (this.storage.length > this.config.maxStorageEntries) {
        this.storage.shift()
      }
    }

    // Notify listeners
    this.listeners.forEach(listener => {
      try {
        listener(entry)
      } catch (e) {
        // Prevent listener errors from breaking logging
      }
    })
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context)
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context)
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context)
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log('error', message, context, error)
  }

  // Subscribe to log entries
  subscribe(callback: (entry: LogEntry) => void): () => void {
    this.listeners.push(callback)
    return () => {
      const index = this.listeners.indexOf(callback)
      if (index !== -1) {
        this.listeners.splice(index, 1)
      }
    }
  }

  // Get recent logs
  getLogs(level?: LogLevel, limit = 100): LogEntry[] {
    let logs = this.storage
    if (level) {
      logs = logs.filter(l => l.level === level)
    }
    return logs.slice(-limit)
  }

  // Clear logs
  clear(): void {
    this.storage = []
  }

  // Export logs
  export(): string {
    return JSON.stringify(this.storage, null, 2)
  }
}

// Create loggers for different modules
export const logger = new Logger({ minLevel: 'info' })
export const dbLogger = new Logger({ minLevel: 'warn' })
export const apiLogger = new Logger({ minLevel: 'info' })
export const wsLogger = new Logger({ minLevel: 'warn' })

export { Logger }
export type { LogEntry, LogLevel, LoggerConfig }
