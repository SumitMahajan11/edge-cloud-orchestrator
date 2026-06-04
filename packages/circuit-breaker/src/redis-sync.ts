import { createLogger } from '@edgecloud/shared-kernel';
import Redis from 'ioredis';

import { CircuitBreakerRegistry, CircuitState } from './circuit-breaker';

const logger = createLogger('circuit-breaker-sync');

export class RedisCircuitBreakerSync {
  private readonly stateKeyPrefix = 'circuit_breaker:state:';
  private readonly stateTTL = 300; // 5 minutes
  
  constructor(private redis: Redis) {}
  
  // Called when a breaker changes state (CLOSED→OPEN, OPEN→HALF_OPEN, etc.)
  async publishStateChange(
    breakerName: string,
    newState: CircuitState,
    metadata: { failureRate?: number | undefined; lastFailureAt?: Date | undefined } = {}
  ): Promise<void> {
    const key = `${this.stateKeyPrefix}${breakerName}`;
    const value = JSON.stringify({
      breakerName,
      state: newState,
      updatedAt: new Date().toISOString(),
      podId: process.env.POD_NAME || 'unknown',
      ...metadata
    });
    
    await this.redis.setex(key, this.stateTTL, value);
    await this.redis.publish('circuit_breaker:state_change', JSON.stringify({
      breakerName,
      newState,
      metadata
    }));
  }
  
  // Called on pod startup — sync state from Redis
  async syncStateFromRedis(
    registry: CircuitBreakerRegistry
  ): Promise<void> {
    try {
      const keys = await this.redis.keys(`${this.stateKeyPrefix}*`);
      for (const key of keys) {
        try {
          const raw = await this.redis.get(key);
          if (!raw) {continue;}
          const { state, breakerName } = JSON.parse(raw);
          registry.forceState(breakerName, state);
          logger.info({ breakerName, state }, 'Synced circuit breaker state from Redis');
        } catch (err) {
          logger.error({ err, key }, 'Failed to parse circuit breaker state from Redis');
        }
      }
    } catch (err) {
      logger.error({ err }, 'Failed to sync circuit breaker states from Redis');
    }
  }
  
  // Subscribe to state changes from other pods
  async subscribeToStateChanges(
    registry: CircuitBreakerRegistry,
    subscriber: Redis
  ): Promise<void> {
    await subscriber.subscribe('circuit_breaker:state_change');
    subscriber.on('message', (channel, message) => {
      if (channel !== 'circuit_breaker:state_change') {return;}
      try {
        const { breakerName, newState } = JSON.parse(message);
        
        // Only force state if it's different to avoid unnecessary transitions
        const breaker = registry.get(breakerName);
        if (breaker && breaker.getState() !== newState) {
          registry.forceState(breakerName, newState);
          logger.info(
            { breakerName, newState },
            'Circuit breaker state synced from another pod'
          );
        }
      } catch (err) {
        logger.error({ err, message }, 'Failed to parse circuit breaker state change message');
      }
    });
  }
}
