import Redis from "ioredis-mock";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CircuitBreakerRegistry,
  RedisCircuitBreakerSync,
} from "../../packages/circuit-breaker/src";

describe("Distributed Circuit Breaker Sync", () => {
  let redis: any;
  let _registry1: CircuitBreakerRegistry;
  let registry2: CircuitBreakerRegistry;
  let sync1: RedisCircuitBreakerSync;
  let sync2: RedisCircuitBreakerSync;
  let subscriber2: any;

  beforeAll(async () => {
    // Use a shared data store for all mock instances
    redis = new Redis();

    _registry1 = new CircuitBreakerRegistry();
    registry2 = new CircuitBreakerRegistry();

    sync1 = new RedisCircuitBreakerSync(redis);
    sync2 = new RedisCircuitBreakerSync(redis);

    // ioredis-mock shares data between instances by default
    subscriber2 = new Redis();
    await sync2.subscribeToStateChanges(registry2, subscriber2);
  });

  afterAll(async () => {
    await redis.quit();
    await subscriber2.quit();
  });

  it("should synchronize state from registry1 to registry2 via Pub/Sub", async () => {
    const breakerName = "test-service-pubsub";

    // 1. Create breaker in registry2 so it exists
    registry2.getOrCreate(breakerName, { failureThreshold: 3 });

    // 2. Publish state change from sync1
    await sync1.publishStateChange(breakerName, "OPEN");

    // 3. Wait for propagation
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 4. Check registry2
    const breaker2 = registry2.get(breakerName);
    expect(breaker2?.getState()).toBe("OPEN");
  });

  it("should synchronize state on startup from Redis storage", async () => {
    const breakerName = "test-service-startup";

    // 1. Set state in Redis directly (simulating another pod's previous activity)
    await redis.setex(
      `circuit_breaker:state:${breakerName}`,
      300,
      JSON.stringify({
        breakerName,
        state: "OPEN",
        updatedAt: new Date().toISOString(),
      }),
    );

    // 2. Create a new registry and sync
    const registry3 = new CircuitBreakerRegistry();
    const sync3 = new RedisCircuitBreakerSync(redis);
    await sync3.syncStateFromRedis(registry3);

    // 3. Verify
    const breaker3 = registry3.get(breakerName);
    expect(breaker3).toBeDefined();
    expect(breaker3?.getState()).toBe("OPEN");
  });

  it("should not override a more recent local state (optional optimization check)", async () => {
    const breakerName = "test-service-race";

    // 1. Registry 2 has local state CLOSED
    const breaker2 = registry2.getOrCreate(breakerName, {
      failureThreshold: 3,
    });

    // 2. Receive OPEN from sync1
    await sync1.publishStateChange(breakerName, "OPEN");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(breaker2.getState()).toBe("OPEN");

    // 3. Receive CLOSED from sync1
    await sync1.publishStateChange(breakerName, "CLOSED");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(breaker2.getState()).toBe("CLOSED");
  });
});
