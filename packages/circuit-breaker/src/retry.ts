import { EventEmitter } from 'eventemitter3';
import { CircuitBreaker, CircuitBreakerOpenError } from './circuit-breaker';

export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitterType: 'none' | 'full' | 'equal' | 'decorrelated';
  retryableErrors?: string[];
  onRetry?: (attempt: number, error: Error, delay: number) => void;
  
  // Retry Budget
  retryBudget?: {
    maxRetriesPerWindow: number;
    windowMs: number;
  };
  
  // Circuit Breaker Integration
  circuitBreaker?: CircuitBreaker;
}

export interface RetryContext {
  attempt: number;
  startTime: Date;
  errors: Error[];
  totalDuration?: number;
}

export class RetryPolicy extends EventEmitter {
  private config: RetryConfig;
  private retryCount: number = 0;
  private windowStartTime: number = Date.now();

  constructor(config: Partial<RetryConfig> = {}) {
    super();
    this.config = {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      jitterType: 'full',
      ...config,
    };
  }

  async execute<T>(
    fn: (context: RetryContext) => Promise<T>,
    context: Partial<RetryContext> = {}
  ): Promise<T> {
    // Check circuit breaker
    if (this.config.circuitBreaker) {
      const state = this.config.circuitBreaker.getState();
      if (state === 'OPEN') {
        throw new CircuitBreakerOpenError('retry-policy');
      }
    }

    // Check retry budget
    if (this.config.retryBudget && !this.checkRetryBudget()) {
      this.emit('budget_exhausted', { 
        retryCount: this.retryCount, 
        windowMs: this.config.retryBudget.windowMs 
      });
      throw new Error('Retry budget exhausted');
    }

    const retryContext: RetryContext = {
      attempt: context.attempt || 1,
      startTime: context.startTime || new Date(),
      errors: context.errors || [],
    };

    try {
      const result = await fn(retryContext);
      if (retryContext.attempt > 1) {
        this.emit('recovered', { attempt: retryContext.attempt, errors: retryContext.errors });
      }
      
      // Record success on circuit breaker
      if (this.config.circuitBreaker) {
        this.config.circuitBreaker.execute(async () => result);
      }
      
      return result;
    } catch (error) {
      const err = error as Error;
      retryContext.errors.push(err);

      if (!this.shouldRetry(err, retryContext.attempt)) {
        this.emit('exhausted', { context: retryContext, lastError: err });
        throw new RetryExhaustedError(retryContext.errors, retryContext.attempt);
      }

      const delay = this.calculateDelay(retryContext.attempt);
      
      this.emit('retry', {
        attempt: retryContext.attempt,
        error: err,
        delay,
        nextAttempt: retryContext.attempt + 1,
      });

      if (this.config.onRetry) {
        this.config.onRetry(retryContext.attempt, err, delay);
      }

      // Increment retry count for budget
      this.retryCount++;

      await this.sleep(delay);

      return this.execute(fn, {
        ...retryContext,
        attempt: retryContext.attempt + 1,
      });
    }
  }

  private checkRetryBudget(): boolean {
    if (!this.config.retryBudget) return true;

    const now = Date.now();
    
    // Reset window if expired
    if (now - this.windowStartTime >= this.config.retryBudget.windowMs) {
      this.windowStartTime = now;
      this.retryCount = 0;
    }

    return this.retryCount < this.config.retryBudget.maxRetriesPerWindow;
  }

  private shouldRetry(error: Error, attempt: number): boolean {
    if (attempt >= this.config.maxAttempts) {
      return false;
    }

    if (this.config.retryableErrors && this.config.retryableErrors.length > 0) {
      return this.config.retryableErrors.some(e => 
        error.name.includes(e) || error.message.includes(e)
      );
    }

    // Default: retry on network/timeout errors
    const retryablePatterns = [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNRESET',
      'EPIPE',
      'TimeoutError',
      'NetworkError',
    ];

    return retryablePatterns.some(pattern => 
      error.message.includes(pattern) || error.name.includes(pattern)
    );
  }

  private calculateDelay(attempt: number): number {
    const baseDelay = this.config.initialDelay;
    const maxDelay = this.config.maxDelay;
    const multiplier = this.config.backoffMultiplier;

    switch (this.config.jitterType) {
      case 'none':
        // No jitter - pure exponential backoff
        return Math.min(baseDelay * Math.pow(multiplier, attempt - 1), maxDelay);

      case 'full':
        // Full jitter - random between 0 and calculated delay
        const exponentialDelay = baseDelay * Math.pow(multiplier, attempt - 1);
        return Math.min(Math.random() * exponentialDelay, maxDelay);

      case 'equal':
        // Equal jitter - half the delay plus random half
        const eqDelay = baseDelay * Math.pow(multiplier, attempt - 1);
        return Math.min(eqDelay / 2 + Math.random() * eqDelay / 2, maxDelay);

      case 'decorrelated':
        // Decorrelated jitter - prevents synchronized retries
        // sleep = min(cap, random_between(base, sleep * 3))
        const prevDelay = attempt > 1 
          ? baseDelay * Math.pow(multiplier, attempt - 2)
          : baseDelay;
        return Math.min(
          baseDelay + Math.random() * (prevDelay * 3 - baseDelay),
          maxDelay
        );

      default:
        return Math.min(baseDelay * Math.pow(multiplier, attempt - 1), maxDelay);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export class RetryExhaustedError extends Error {
  constructor(
    public readonly errors: Error[],
    public readonly attempts: number
  ) {
    super(`All ${attempts} retry attempts exhausted`);
    this.name = 'RetryExhaustedError';
  }
}

// Decorator for automatic retry
export function withRetry(config?: Partial<RetryConfig>) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const retryPolicy = new RetryPolicy(config);

    descriptor.value = async function (...args: any[]) {
      return retryPolicy.execute(() => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}
