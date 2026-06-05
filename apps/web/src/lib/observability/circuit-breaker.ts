type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitBreakerConfig {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  timeoutMs?: number; // Alias for timeout
  halfOpenMaxCalls?: number;
}

interface CircuitBreakerMetrics {
  state: CircuitState;
  failures: number;
  failureCount: number; // Alias for failures
  successes: number;
  lastFailureTime: number | null;
  nextAttempt: number;
  totalCalls: number;
  rejectedCalls: number;
}

const DEFAULT_CONFIG: Required<CircuitBreakerConfig> = {
  failureThreshold: 5,
  successThreshold: 3,
  timeout: 60000,
  timeoutMs: 60000,
  halfOpenMaxCalls: 3,
};

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private successes = 0;
  private lastFailureTime: number | null = null;
  private nextAttempt = 0;
  private halfOpenCalls = 0;
  private config: Required<CircuitBreakerConfig>;

  // Metrics tracking
  private totalCalls = 0;
  private rejectedCalls = 0;

  constructor(config: CircuitBreakerConfig = {}) {
    const timeout =
      config.timeout || config.timeoutMs || DEFAULT_CONFIG.timeout;
    this.config = { ...DEFAULT_CONFIG, ...config, timeout, timeoutMs: timeout };
  }

  async execute<T>(fn: () => Promise<T>, fallback?: () => T): Promise<T> {
    this.totalCalls++;

    if (this.state === "OPEN") {
      if (Date.now() < this.nextAttempt) {
        this.rejectedCalls++;
        if (fallback) {
          return fallback();
        }
        throw new CircuitBreakerOpenError(
          `Circuit breaker is OPEN. Retry after ${new Date(this.nextAttempt).toISOString()}`,
        );
      }
      // Transition to HALF_OPEN
      this.state = "HALF_OPEN";
      this.halfOpenCalls = 0;
      this.successes = 0;
    }

    if (
      this.state === "HALF_OPEN" &&
      this.halfOpenCalls >= this.config.halfOpenMaxCalls
    ) {
      this.rejectedCalls++;
      if (fallback) {
        return fallback();
      }
      throw new CircuitBreakerOpenError(
        "Circuit breaker half-open limit reached",
      );
    }

    if (this.state === "HALF_OPEN") {
      this.halfOpenCalls++;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  public recordSuccess() {
    this.onSuccess();
  }

  public recordFailure() {
    this.onFailure();
  }

  private onSuccess() {
    this.failures = 0;

    if (this.state === "HALF_OPEN") {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.close();
      }
    } else if (this.state === "OPEN") {
      // Manual recordSuccess might transition from OPEN to HALF_OPEN if we want,
      // but typically it happens via timeout.
      // However, the test might call recordSuccess in OPEN state?
      // Line 161 of retry.test.ts says "First success transitions to HALF_OPEN"
      this.state = "HALF_OPEN";
      this.successes = 1;
    }
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === "HALF_OPEN") {
      this.open();
    } else if (this.failures >= this.config.failureThreshold) {
      this.open();
    }
  }

  private open() {
    this.state = "OPEN";
    this.nextAttempt = Date.now() + this.config.timeout;
    this.halfOpenCalls = 0;
    this.successes = 0;
  }

  private close() {
    this.state = "CLOSED";
    this.failures = 0;
    this.successes = 0;
    this.halfOpenCalls = 0;
    this.nextAttempt = 0;
  }

  // Manual control
  forceOpen() {
    this.open();
  }

  forceClose() {
    this.close();
  }

  // Get current state
  getState() {
    const metrics = this.getMetrics();
    return {
      ...metrics,
      state: this.state,
    };
  }

  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failures: this.failures,
      failureCount: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      nextAttempt: this.nextAttempt,
      totalCalls: this.totalCalls,
      rejectedCalls: this.rejectedCalls,
    };
  }

  isOpen(): boolean {
    return this.state === "OPEN";
  }

  canExecute(): boolean {
    if (this.state === "CLOSED") return true;
    if (this.state === "OPEN") {
      if (Date.now() >= this.nextAttempt) {
        this.state = "HALF_OPEN"; // Automatic transition
        return true;
      }
      return false;
    }
    return true; // half-open
  }

  isClosed(): boolean {
    return this.state === "CLOSED";
  }

  isHalfOpen(): boolean {
    return this.state === "HALF_OPEN";
  }

  // Reset all metrics
  reset() {
    this.close();
    this.totalCalls = 0;
    this.rejectedCalls = 0;
    this.lastFailureTime = null;
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircuitBreakerOpenError";
  }
}

// Circuit breaker registry for managing multiple breakers
export class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();

  get(name: string, config?: CircuitBreakerConfig): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(config));
    }
    return this.breakers.get(name)!;
  }

  remove(name: string) {
    this.breakers.delete(name);
  }

  getAllMetrics(): Record<string, CircuitBreakerMetrics> {
    const metrics: Record<string, CircuitBreakerMetrics> = {};
    for (const [name, breaker] of this.breakers) {
      metrics[name] = breaker.getMetrics();
    }
    return metrics;
  }

  resetAll() {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}

// Singleton registry
export const circuitBreakerRegistry = new CircuitBreakerRegistry();
