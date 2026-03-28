type ShutdownHandler = () => Promise<void> | void

interface LifecycleConfig {
  shutdownTimeoutMs?: number
  gracefulShutdownDelayMs?: number
}

interface LifecycleState {
  isShuttingDown: boolean
  isReady: boolean
  startTime: number
}

class LifecycleManager {
  private shutdownHandlers: ShutdownHandler[] = []
  private config: Required<LifecycleConfig>
  private state: LifecycleState = {
    isShuttingDown: false,
    isReady: false,
    startTime: Date.now(),
  }

  constructor(config: LifecycleConfig = {}) {
    this.config = {
      shutdownTimeoutMs: 30000,
      gracefulShutdownDelayMs: 5000,
      ...config,
    }

    this.setupSignalHandlers()
  }

  private setupSignalHandlers(): void {
    // Browser environment - handle page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.shutdown()
      })
    }
  }

  onShutdown(handler: ShutdownHandler): () => void {
    this.shutdownHandlers.push(handler)
    return () => {
      const index = this.shutdownHandlers.indexOf(handler)
      if (index !== -1) {
        this.shutdownHandlers.splice(index, 1)
      }
    }
  }

  async shutdown(_exitCode = 0): Promise<void> {
    if (this.state.isShuttingDown) {
      console.log('Shutdown already in progress...')
      return
    }

    this.state.isShuttingDown = true
    console.log('Starting graceful shutdown...')

    // Set a timeout for forced shutdown
    const forceShutdownTimeout = setTimeout(() => {
      console.error('Forced shutdown due to timeout')
      // In browser, we can't force exit
    }, this.config.shutdownTimeoutMs)

    try {
      // Run shutdown handlers in reverse order (LIFO)
      const handlers = [...this.shutdownHandlers].reverse()

      for (const handler of handlers) {
        try {
          await Promise.race([
            handler(),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error('Shutdown handler timeout')),
                this.config.shutdownTimeoutMs / handlers.length
              )
            ),
          ])
        } catch (error) {
          console.error('Shutdown handler failed:', error)
          // Continue with other handlers even if one fails
        }
      }

      clearTimeout(forceShutdownTimeout)
      console.log('Graceful shutdown completed')
      // In browser, we don't exit process
    } catch (error) {
      clearTimeout(forceShutdownTimeout)
      console.error('Graceful shutdown failed:', error)
      // In browser, we don't exit process
    }
  }

  markReady(): void {
    this.state.isReady = true
    console.log('Application marked as ready')
  }

  markNotReady(): void {
    this.state.isReady = false
    console.log('Application marked as not ready')
  }

  isReady(): boolean {
    return this.state.isReady && !this.state.isShuttingDown
  }

  isShuttingDown(): boolean {
    return this.state.isShuttingDown
  }

  getUptime(): number {
    return Date.now() - this.state.startTime
  }

  getState(): LifecycleState {
    return { ...this.state }
  }

  // Predefined shutdown handlers
  registerDatabaseShutdown(closeFn: () => Promise<void>): void {
    this.onShutdown(async () => {
      console.log('Closing database connections...')
      await closeFn()
    })
  }

  registerCacheShutdown(closeFn: () => Promise<void>): void {
    this.onShutdown(async () => {
      console.log('Closing cache connections...')
      await closeFn()
    })
  }

  registerServerShutdown(closeFn: () => Promise<void>): void {
    this.onShutdown(async () => {
      console.log('Closing server...')
      await closeFn()
    })
  }

  registerWebhookShutdown(closeFn: () => Promise<void>): void {
    this.onShutdown(async () => {
      console.log('Closing webhook connections...')
      await closeFn()
    })
  }
}

// Request context for tracking
interface RequestContext {
  requestId: string
  startTime: number
  metadata: Record<string, unknown>
}

class RequestContextManager {
  private context: RequestContext | null = null

  setContext(context: RequestContext): void {
    this.context = context
  }

  getContext(): RequestContext | null {
    return this.context
  }

  clearContext(): void {
    this.context = null
  }

  getRequestId(): string | null {
    return this.context?.requestId ?? null
  }

  getDuration(): number | null {
    if (!this.context) return null
    return Date.now() - this.context.startTime
  }
}

// Singleton instances
export const lifecycleManager = new LifecycleManager()
export const requestContext = new RequestContextManager()

export { LifecycleManager, RequestContextManager }
export type { ShutdownHandler, LifecycleConfig, LifecycleState, RequestContext }
