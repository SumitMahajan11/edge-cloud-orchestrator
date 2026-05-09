import {
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitBreakerRegistry,
} from '@edgecloud/circuit-breaker';

import { createLogger } from '../lib/logger';
import { WebSocketManager } from '../services/websocket-manager';

const logger = createLogger('circuit-breaker');

// Global registry for all circuit breakers
export const globalCircuitBreakerRegistry = new CircuitBreakerRegistry();
let wsManager: WebSocketManager | undefined;

/**
 * Configure the registry to broadcast state changes via WebSocket
 */
export function setWebSocketManager(manager: WebSocketManager) {
  wsManager = manager;
}

// Circuit breaker configurations for different service types
export const circuitBreakerConfigs = {
  // Database circuit breaker - conservative due to criticality
  database: {
    name: 'PostgreSQL',
    failureThreshold: 5,
    resetTimeout: 30000, // 30 seconds
    halfOpenMaxCalls: 3,
    successThreshold: 2,
  } as CircuitBreakerConfig,

  // Redis circuit breaker - more aggressive recovery
  redis: {
    name: 'Redis',
    failureThreshold: 3,
    resetTimeout: 10000, // 10 seconds
    halfOpenMaxCalls: 2,
    successThreshold: 1,
  } as CircuitBreakerConfig,

  // External API circuit breaker - conservative
  externalApi: {
    name: 'External-API',
    failureThreshold: 5,
    resetTimeout: 60000, // 60 seconds
    halfOpenMaxCalls: 3,
    successThreshold: 2,
  } as CircuitBreakerConfig,

  // Vault/PKI circuit breaker
  vaultPki: {
    name: 'VaultPKI',
    failureThreshold: 3,
    resetTimeout: 45000,
    halfOpenMaxCalls: 2,
    successThreshold: 1,
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

/**
 * Get or create a circuit breaker for a service
 */
export function getCircuitBreaker(
  config: CircuitBreakerConfig,
): CircuitBreaker {
  const cb = globalCircuitBreakerRegistry.getOrCreate(config.name, config);

  // Add logging and WebSocket broadcasts for state changes if not already set
  if (cb.listenerCount('open') === 0) {
    cb.on('open', () => {
      logger.warn({ breaker: config.name }, 'Circuit breaker opened');
      wsManager?.broadcast('circuit_breaker.opened', { name: config.name, timestamp: new Date().toISOString() });
    });

    cb.on('close', () => {
      logger.info({ breaker: config.name }, 'Circuit breaker closed (healthy)');
      wsManager?.broadcast('circuit_breaker.closed', { name: config.name, timestamp: new Date().toISOString() });
    });

    cb.on('halfOpen', () => {
      logger.info(
        { breaker: config.name },
        'Circuit breaker half-open (testing)',
      );
      wsManager?.broadcast('circuit_breaker.half_open', { name: config.name, timestamp: new Date().toISOString() });
    });
  }

  return cb;
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
  return globalCircuitBreakerRegistry.getAllMetrics();
}

/**
 * Get all circuit breaker states for the UI
 */
export function getAllCircuitBreakerStates() {
  return globalCircuitBreakerRegistry.getAllStates();
}

/**
 * Force close all circuit breakers (useful for testing or manual recovery)
 */
export function forceCloseAllCircuitBreakers(): void {
  globalCircuitBreakerRegistry.resetAll();
}
