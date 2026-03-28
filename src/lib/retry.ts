import { logger } from './logger'

interface CircuitBreakerConfig {
  failureThreshold?: number
  successThreshold?: number
  timeoutMs?: number
}

interface RetryConfig {
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  retryableErrors?: string[]
  onRetry?: (attempt: number, error: Error, delayMs: number) => void
}

const DEFAULT_CONFIG: Required<RetryConfig> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'Network Error',
    'timeout',
    'Timeout',
  ],
  onRetry: () => {},
}

class RetryManager {
  private config: Required<RetryConfig>

  constructor(config: RetryConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  private isRetryableError(error: Error): boolean {
    const errorMessage = error.message || ''
    return this.config.retryableErrors.some(retryable =>
      errorMessage.includes(retryable)
    )
  }

  private calculateDelay(attempt: number): number {
    const exponentialDelay = this.config.initialDelayMs *
      Math.pow(this.config.backoffMultiplier, attempt - 1)
    const jitter = Math.random() * 1000 // Add up to 1s jitter
    return Math.min(exponentialDelay + jitter, this.config.maxDelayMs)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async execute<T>(operation: () => Promise<T>, operationName = 'operation'): Promise<T> {
    let lastError: Error | undefined

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        const result = await operation()
        
        if (attempt > 1) {
          logger.info(`${operationName} succeeded after ${attempt} attempts`)
        }
        
        return result
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Don't retry if error is not retryable
        if (!this.isRetryableError(lastError)) {
          logger.warn(`${operationName} failed with non-retryable error`, { error: lastError.message })
          throw lastError
        }

        // Don't retry on last attempt
        if (attempt === this.config.maxAttempts) {
          logger.error(`${operationName} failed after ${this.config.maxAttempts} attempts`, lastError)
          throw lastError
        }

        const delayMs = this.calculateDelay(attempt)
        
        logger.warn(`${operationName} failed (attempt ${attempt}/${this.config.maxAttempts}), retrying in ${delayMs}ms`, {
          error: lastError.message,
        })

        this.config.onRetry(attempt, lastError, delayMs)
        await this.sleep(delayMs)
      }
    }

    throw lastError || new Error(`${operationName} failed`)
  }

  // Execute with circuit breaker pattern
  async executeWithCircuitBreaker<T>(
    operation: () => Promise<T>,
    circuitBreaker: CircuitBreaker,
    operationName = 'operation'
  ): Promise<T> {
    if (!circuitBreaker.canExecute()) {
      throw new Error(`Circuit breaker is OPEN for ${operationName}`)
    }

    try {
      const result = await this.execute(operation, operationName)
      circuitBreaker.recordSuccess()
      return result
    } catch (error) {
      circuitBreaker.recordFailure()
      throw error
    }
  }
}

// Circuit breaker for preventing cascade failures
class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED'
  private failureCount = 0
  private successCount = 0
  // private lastFailureTime?: number  // Reserved for future use
  private nextAttemptTime?: number
  private config: Required<CircuitBreakerConfig>

  constructor(config: CircuitBreakerConfig = {}) {
    this.config = {
      failureThreshold: 5,
      successThreshold: 3,
      timeoutMs: 60000,
      ...config,
    }
  }

  canExecute(): boolean {
    if (this.state === 'CLOSED') return true
    
    if (this.state === 'OPEN') {
      if (Date.now() >= (this.nextAttemptTime || 0)) {
        this.state = 'HALF_OPEN'
        this.successCount = 0
        logger.info('Circuit breaker entering HALF_OPEN state')
        return true
      }
      return false
    }

    return true // HALF_OPEN
  }

  recordSuccess(): void {
    this.failureCount = 0

    if (this.state === 'HALF_OPEN') {
      this.successCount++
      
      if (this.successCount >= (this.config.successThreshold || 3)) {
        this.state = 'CLOSED'
        this.successCount = 0
        logger.info('Circuit breaker CLOSED')
      }
    }
  }

  recordFailure(): void {
    this.failureCount++
    // this.lastFailureTime = Date.now()  // Reserved for future use

    if (this.state === 'HALF_OPEN' || this.failureCount >= (this.config.failureThreshold || 5)) {
      this.state = 'OPEN'
      this.nextAttemptTime = Date.now() + (this.config.timeoutMs || 60000)
      logger.warn(`Circuit breaker OPENED, retry after ${this.config.timeoutMs}ms`)
    }
  }

  getState(): { state: string; failureCount: number; successCount: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
    }
  }
}

// Decorator for retry
export function withRetry(config?: RetryConfig) {
  const retryManager = new RetryManager(config)
  
  return function<T extends (...args: unknown[]) => Promise<unknown>>(
    target: T,
    context: ClassMethodDecoratorContext
  ): T {
    return async function(this: unknown, ...args: Parameters<T>): Promise<ReturnType<T>> {
      return retryManager.execute(() => target.apply(this, args), String(context.name)) as ReturnType<T>
    } as T
  }
}

// Singleton instances
export const retryManager = new RetryManager()
export const apiCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  timeoutMs: 30000,
})

export { RetryManager, CircuitBreaker }
export type { RetryConfig }
