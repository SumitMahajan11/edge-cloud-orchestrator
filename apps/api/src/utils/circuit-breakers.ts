/**
 * Circuit breaker configurations for external dependencies
 * Applied to: DB calls, Redis calls, External APIs
 */

import {
  CircuitBreaker,
  CircuitBreakerConfig,
} from '@edgecloud/circuit-breaker';

import { createLogger } from '../lib/logger';

const logger = createLogger('circuit-breaker');

// Circuit breaker configurations for different service types
export const circuitBreakerConfigs = {
  // Database circuit breaker - conservative due to criticality
  database: {
    name: 'database',
    failureThreshold: 5,
    resetTimeout: 30000, // 30 seconds
    halfOpenMaxCalls: 3,
    successThreshold: 2,
  } as CircuitBreakerConfig,

  // Redis circuit breaker - more aggressive recovery
  redis: {
    name: 'redis',
    failureThreshold: 3,
    resetTimeout: 10000, // 10 seconds
    halfOpenMaxCalls: 2,
    successThreshold: 1,
  } as CircuitBreakerConfig,

  // External API circuit breaker - conservative
  externalApi: {
    name: 'external-api',
    failureThreshold: 5,
    resetTimeout: 60000, // 60 seconds
    halfOpenMaxCalls: 3,
    successThreshold: 2,
  } as CircuitBreakerConfig,

  // Node agent circuit breaker
  nodeAgent: {
    name: 'node-agent',
    failureThreshold: 3,
    resetTimeout: 30000, // 30 seconds
    halfOpenMaxCalls: 2,
    successThreshold: 1,
  } as CircuitBreakerConfig,
};

// Singleton circuit breaker instances
const circuitBreakers = new Map<string, CircuitBreaker>();

/**
 * Get or create a circuit breaker for a service
 */
export function getCircuitBreaker(
  config: CircuitBreakerConfig,
): CircuitBreaker {
  if (!circuitBreakers.has(config.name)) {
    const cb = new CircuitBreaker(config);

    // Add logging for state changes
    cb.on('open', () => {
      logger.warn({ breaker: config.name }, 'Circuit breaker opened');
    });

    cb.on('close', () => {
      logger.info({ breaker: config.name }, 'Circuit breaker closed (healthy)');
    });

    cb.on('halfOpen', () => {
      logger.info(
        { breaker: config.name },
        'Circuit breaker half-open (testing)',
      );
    });

    circuitBreakers.set(config.name, cb);
  }

  return circuitBreakers.get(config.name)!;
}

/**
 * Execute function with circuit breaker protection
 */
export async function withCircuitBreaker<T>(
  config: CircuitBreakerConfig,
  fn: () => Promise<T>,
  fallback?: () => T,
): Promise<T> {
  const cb = getCircuitBreaker(config);
  return cb.execute(fn, fallback);
}

/**
 * Get metrics for all circuit breakers
 */
export function getAllCircuitBreakerMetrics() {
  const metrics: Record<string, ReturnType<CircuitBreaker['getMetrics']>> = {};

  for (const [name, cb] of circuitBreakers.entries()) {
    metrics[name] = cb.getMetrics();
  }

  return metrics;
}

/**
 * Force close all circuit breakers (useful for testing or manual recovery)
 */
export function forceCloseAllCircuitBreakers(): void {
  for (const cb of circuitBreakers.values()) {
    cb.forceClose();
  }
}
