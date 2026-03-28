type CircuitState = 'closed' | 'open' | 'half-open'

interface CircuitBreakerConfig {
  failureThreshold?: number
  successThreshold?: number
  timeout?: number
  halfOpenMaxCalls?: number
}

interface CircuitBreakerMetrics {
  state: CircuitState
  failures: number
  successes: number
  lastFailureTime: number | null
  nextAttempt: number
  totalCalls: number
  rejectedCalls: number
}

const DEFAULT_CONFIG: Required<CircuitBreakerConfig> = {
  failureThreshold: 5,
  successThreshold: 3,
  timeout: 60000, // 1 minute
  halfOpenMaxCalls: 3
}

class CircuitBreaker {
  private state: CircuitState = 'closed'
  private failures = 0
  private successes = 0
  private lastFailureTime: number | null = null
  private nextAttempt = 0
  private halfOpenCalls = 0
  private config: Required<CircuitBreakerConfig>
  
  // Metrics tracking
  private totalCalls = 0
  private rejectedCalls = 0

  constructor(config: CircuitBreakerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async execute<T>(fn: () => Promise<T>, fallback?: () => T): Promise<T> {
    this.totalCalls++

    if (this.state === 'open') {
      if (Date.now() < this.nextAttempt) {
        this.rejectedCalls++
        if (fallback) {
          return fallback()
        }
        throw new CircuitBreakerOpenError(
          `Circuit breaker is OPEN. Retry after ${new Date(this.nextAttempt).toISOString()}`
        )
      }
      // Transition to half-open
      this.state = 'half-open'
      this.halfOpenCalls = 0
      this.successes = 0
    }

    if (this.state === 'half-open' && this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
      this.rejectedCalls++
      if (fallback) {
        return fallback()
      }
      throw new CircuitBreakerOpenError('Circuit breaker half-open limit reached')
    }

    if (this.state === 'half-open') {
      this.halfOpenCalls++
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  private onSuccess() {
    this.failures = 0

    if (this.state === 'half-open') {
      this.successes++
      if (this.successes >= this.config.successThreshold) {
        this.close()
      }
    }
  }

  private onFailure() {
    this.failures++
    this.lastFailureTime = Date.now()

    if (this.state === 'half-open') {
      this.open()
    } else if (this.failures >= this.config.failureThreshold) {
      this.open()
    }
  }

  private open() {
    this.state = 'open'
    this.nextAttempt = Date.now() + this.config.timeout
    this.halfOpenCalls = 0
    this.successes = 0
  }

  private close() {
    this.state = 'closed'
    this.failures = 0
    this.successes = 0
    this.halfOpenCalls = 0
    this.nextAttempt = 0
  }

  // Manual control
  forceOpen() {
    this.open()
  }

  forceClose() {
    this.close()
  }

  // Get current state
  getState(): CircuitState {
    return this.state
  }

  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      nextAttempt: this.nextAttempt,
      totalCalls: this.totalCalls,
      rejectedCalls: this.rejectedCalls
    }
  }

  isOpen(): boolean {
    return this.state === 'open'
  }

  isClosed(): boolean {
    return this.state === 'closed'
  }

  isHalfOpen(): boolean {
    return this.state === 'half-open'
  }

  // Reset all metrics
  reset() {
    this.close()
    this.totalCalls = 0
    this.rejectedCalls = 0
    this.lastFailureTime = null
  }
}

class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CircuitBreakerOpenError'
  }
}

// Circuit breaker registry for managing multiple breakers
class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map()

  get(name: string, config?: CircuitBreakerConfig): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(config))
    }
    return this.breakers.get(name)!
  }

  remove(name: string) {
    this.breakers.delete(name)
  }

  getAllMetrics(): Record<string, CircuitBreakerMetrics> {
    const metrics: Record<string, CircuitBreakerMetrics> = {}
    for (const [name, breaker] of this.breakers) {
      metrics[name] = breaker.getMetrics()
    }
    return metrics
  }

  resetAll() {
    for (const breaker of this.breakers.values()) {
      breaker.reset()
    }
  }
}

// Singleton registry
export const circuitBreakerRegistry = new CircuitBreakerRegistry()

export { CircuitBreaker, CircuitBreakerRegistry, CircuitBreakerOpenError }
export type { CircuitState, CircuitBreakerConfig, CircuitBreakerMetrics }
