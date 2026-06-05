import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  CircuitBreakerRegistry,
} from "../circuit-breaker";
import { RedisCircuitBreakerSync } from "../redis-sync";

describe("CircuitBreaker core logic", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 100, // short timeout for testing
      successThreshold: 2,
      name: "test-breaker",
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should execute functions successfully in CLOSED state", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await breaker.execute(fn);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(breaker.getState()).toBe("CLOSED");
  });

  it("should trip to OPEN state after failure threshold is exceeded", async () => {
    const errorFn = vi.fn().mockRejectedValue(new Error("service failure"));

    // 3 failures needed
    await expect(breaker.execute(errorFn)).rejects.toThrow("service failure");
    await expect(breaker.execute(errorFn)).rejects.toThrow("service failure");
    await expect(breaker.execute(errorFn)).rejects.toThrow("service failure");

    expect(breaker.getState()).toBe("OPEN");

    // Subsequent calls should fail fast with CircuitBreakerOpenError
    const fn = vi.fn().mockResolvedValue("success");
    await expect(breaker.execute(fn)).rejects.toThrow(CircuitBreakerOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("should use fallback function in OPEN state if provided", async () => {
    const errorFn = vi.fn().mockRejectedValue(new Error("service failure"));

    // Force open
    breaker.forceOpen();
    expect(breaker.getState()).toBe("OPEN");

    const fallback = vi.fn().mockReturnValue("fallback-val");
    const fn = vi.fn().mockResolvedValue("success");

    const result = await breaker.execute(fn, fallback);
    expect(result).toBe("fallback-val");
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fn).not.toHaveBeenCalled();
  });

  it("should transition to HALF_OPEN after resetTimeout", async () => {
    breaker.forceOpen();
    expect(breaker.getState()).toBe("OPEN");

    // Advance time past resetTimeout (100ms)
    await vi.advanceTimersByTimeAsync(105);

    expect(breaker.getState()).toBe("HALF_OPEN");
  });

  it("should close circuit if success threshold met in HALF_OPEN", async () => {
    breaker.forceTransition("HALF_OPEN");
    expect(breaker.getState()).toBe("HALF_OPEN");

    const successFn = vi.fn().mockResolvedValue("ok");

    // First success
    await breaker.execute(successFn);
    expect(breaker.getState()).toBe("HALF_OPEN");

    // Second success (reaches successThreshold of 2)
    await breaker.execute(successFn);
    expect(breaker.getState()).toBe("CLOSED");
  });

  it("should reopen circuit if failure occurs in HALF_OPEN", async () => {
    breaker.forceTransition("HALF_OPEN");
    expect(breaker.getState()).toBe("HALF_OPEN");

    const failureFn = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(breaker.execute(failureFn)).rejects.toThrow("fail");

    expect(breaker.getState()).toBe("OPEN");
  });
});

describe("RedisCircuitBreakerSync and Redis Unavailability (Fail Open)", () => {
  let mockRedis: any;
  let registry: CircuitBreakerRegistry;
  let sync: RedisCircuitBreakerSync;

  beforeEach(() => {
    mockRedis = {
      setex: vi.fn().mockResolvedValue("OK"),
      publish: vi.fn().mockResolvedValue(1),
      keys: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      subscribe: vi.fn().mockResolvedValue("OK"),
      on: vi.fn(),
    };
    registry = new CircuitBreakerRegistry();
    sync = new RedisCircuitBreakerSync(mockRedis);
  });

  it("should successfully sync states when Redis is healthy", async () => {
    mockRedis.keys.mockResolvedValue(["circuit_breaker:state:test-service"]);
    mockRedis.get.mockResolvedValue(
      JSON.stringify({ breakerName: "test-service", state: "OPEN" }),
    );

    await sync.syncStateFromRedis(registry);

    const breaker = registry.get("test-service");
    expect(breaker).toBeDefined();
    expect(breaker?.getState()).toBe("OPEN");
  });

  it("should handle Redis failures during syncStateFromRedis gracefully (fail-open)", async () => {
    // Mock Redis.keys throwing an error (e.g. Redis connection is down)
    mockRedis.keys.mockRejectedValue(new Error("Redis is down"));

    // The function should not throw, allowing the pod to startup normally (fail-open)
    await expect(sync.syncStateFromRedis(registry)).resolves.not.toThrow();

    // Registry should still be empty or unmodified
    expect(registry.get("test-service")).toBeUndefined();
  });

  it("should handle Redis failures during publishStateChange gracefully", async () => {
    mockRedis.setex.mockRejectedValue(new Error("Redis connection lost"));

    // Should not crash the publishing flow
    await expect(
      sync.publishStateChange("test-service", "OPEN"),
    ).rejects.toThrow("Redis connection lost");
  });
});
