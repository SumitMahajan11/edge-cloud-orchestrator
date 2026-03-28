import { EventEmitter } from 'eventemitter3';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  halfOpenMaxCalls: number;
  successThreshold: number;
  name: string;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerMetrics {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime?: Date;
  consecutiveSuccesses: number;
  totalCalls: number;
  rejectedCalls: number;
}

export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private consecutiveSuccesses = 0;
  private totalCalls = 0;
  private rejectedCalls = 0;
  private lastFailureTime?: Date;
  private halfOpenCalls = 0;
  private resetTimer?: NodeJS.Timeout;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    super();
    this.config = {
      failureThreshold: 5,
      resetTimeout: 30000,
      halfOpenMaxCalls: 3,
      successThreshold: 2,
      name: 'default',
      ...config,
    };
  }

  async execute<T>(fn: () => Promise<T>, fallback?: () => T): Promise<T> {
    this.totalCalls++;

    if (this.state === 'OPEN') {
      this.rejectedCalls++;
      this.emit('rejected', { name: this.config.name });
      
      if (fallback) {
        return fallback();
      }
      throw new CircuitBreakerOpenError(this.config.name);
    }

    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
        this.rejectedCalls++;
        throw new CircuitBreakerOpenError(this.config.name);
      }
      this.halfOpenCalls++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      if (fallback) {
        return fallback();
      }
      throw error;
    }
  }

  private onSuccess(): void {
    this.successes++;
    this.consecutiveSuccesses++;

    if (this.state === 'HALF_OPEN') {
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.closeCircuit();
      }
    }

    this.emit('success', { name: this.config.name });
  }

  private onFailure(): void {
    this.failures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = new Date();

    if (this.state === 'HALF_OPEN') {
      this.openCircuit();
      return;
    }

    if (this.failures >= this.config.failureThreshold) {
      this.openCircuit();
    }

    this.emit('failure', { name: this.config.name, failures: this.failures });
  }

  private openCircuit(): void {
    if (this.state === 'OPEN') return;

    this.state = 'OPEN';
    this.emit('open', { name: this.config.name });

    // Schedule transition to half-open
    this.resetTimer = setTimeout(() => {
      this.halfOpenCircuit();
    }, this.config.resetTimeout);
  }

  private halfOpenCircuit(): void {
    if (this.state !== 'OPEN') return;

    this.state = 'HALF_OPEN';
    this.halfOpenCalls = 0;
    this.consecutiveSuccesses = 0;
    this.emit('halfOpen', { name: this.config.name });
  }

  private closeCircuit(): void {
    if (this.state === 'CLOSED') return;

    this.state = 'CLOSED';
    this.failures = 0;
    this.halfOpenCalls = 0;
    this.consecutiveSuccesses = 0;
    
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }

    this.emit('close', { name: this.config.name });
  }

  getState(): CircuitState {
    return this.state;
  }

  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalCalls: this.totalCalls,
      rejectedCalls: this.rejectedCalls,
    };
  }

  forceOpen(): void {
    this.openCircuit();
  }

  forceClose(): void {
    this.closeCircuit();
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(public readonly circuitName: string) {
    super(`Circuit breaker '${circuitName}' is OPEN`);
    this.name = 'CircuitBreakerOpenError';
  }
}

// Circuit breaker registry for managing multiple breakers
export class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();

  getOrCreate(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker({ name, ...config }));
    }
    return this.breakers.get(name)!;
  }

  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  healthCheck(): Record<string, CircuitBreakerMetrics> {
    const health: Record<string, CircuitBreakerMetrics> = {};
    for (const [name, breaker] of this.breakers) {
      health[name] = breaker.getMetrics();
    }
    return health;
  }

  /**
   * Get all metrics for all circuit breakers (alias for healthCheck)
   */
  getAllMetrics(): Record<string, CircuitBreakerMetrics> {
    return this.healthCheck();
  }

  /**
   * Reset all circuit breakers (useful for testing or recovery)
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.forceClose();
    }
  }

  /**
   * Remove a circuit breaker from the registry
   */
  remove(name: string): boolean {
    return this.breakers.delete(name);
  }
}
