import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  CircuitBreakerRegistry,
} from "../circuit-breaker";
import { RedisCircuitBreakerSync } from "../redis-sync";
import * as indexExports from "../index";

describe("CircuitBreaker Unit Tests", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 1000,
      halfOpenMaxCalls: 2,
      successThreshold: 2,
      name: "payment-service",
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Index Exports", () => {
    it("should export all required classes and types", () => {
      expect(indexExports.CircuitBreaker).toBeDefined();
      expect(indexExports.CircuitBreakerOpenError).toBeDefined();
      expect(indexExports.CircuitBreakerRegistry).toBeDefined();
      expect(indexExports.RetryPolicy).toBeDefined();
      expect(indexExports.RetryExhaustedError).toBeDefined();
      expect(indexExports.withRetry).toBeDefined();
      expect(indexExports.CheckpointManager).toBeDefined();
      expect(indexExports.InMemoryCheckpointStore).toBeDefined();
      expect(indexExports.AutomaticCheckpointing).toBeDefined();
      expect(indexExports.RedisCircuitBreakerSync).toBeDefined();
    });
  });

  describe("1. State Transitions & Lifecycle", () => {
    it("should initialize in CLOSED state with zero metrics", () => {
      expect(breaker.getState()).toBe("CLOSED");
      const metrics = breaker.getMetrics();
      expect(metrics.state).toBe("CLOSED");
      expect(metrics.failures).toBe(0);
      expect(metrics.successes).toBe(0);
      expect(metrics.consecutiveSuccesses).toBe(0);
      expect(metrics.totalCalls).toBe(0);
      expect(metrics.rejectedCalls).toBe(0);
      expect(metrics.lastFailureTime).toBeUndefined();
      expect(metrics.nextRetryAt).toBeUndefined();
    });

    it("should transition CLOSED -> OPEN when failure threshold is reached", async () => {
      const openSpy = vi.fn();
      breaker.on("open", openSpy);

      const err = new Error("Connection failed");
      const failFn = vi.fn().mockRejectedValue(err);

      // 1st failure
      await expect(breaker.execute(failFn)).rejects.toThrow("Connection failed");
      expect(breaker.getState()).toBe("CLOSED");

      // 2nd failure
      await expect(breaker.execute(failFn)).rejects.toThrow("Connection failed");
      expect(breaker.getState()).toBe("CLOSED");

      // 3rd failure (trips threshold)
      await expect(breaker.execute(failFn)).rejects.toThrow("Connection failed");
      expect(breaker.getState()).toBe("OPEN");
      expect(openSpy).toHaveBeenCalledWith({ name: "payment-service" });
      expect(breaker.getMetrics().nextRetryAt).toBeDefined();
    });

    it("should transition OPEN -> HALF_OPEN when resetTimeout expires", async () => {
      const halfOpenSpy = vi.fn();
      breaker.on("halfOpen", halfOpenSpy);

      breaker.forceOpen();
      expect(breaker.getState()).toBe("OPEN");

      // Advance timers before resetTimeout (e.g. 999ms)
      await vi.advanceTimersByTimeAsync(999);
      expect(breaker.getState()).toBe("OPEN");
      expect(halfOpenSpy).not.toHaveBeenCalled();

      // Advance timers to reach resetTimeout (1000ms total)
      await vi.advanceTimersByTimeAsync(1);
      expect(breaker.getState()).toBe("HALF_OPEN");
      expect(halfOpenSpy).toHaveBeenCalledWith({ name: "payment-service" });
      expect(breaker.getMetrics().nextRetryAt).toBeUndefined();
    });

    it("should transition HALF_OPEN -> CLOSED when successThreshold is achieved", async () => {
      const closeSpy = vi.fn();
      breaker.on("close", closeSpy);

      breaker.forceTransition("HALF_OPEN");
      expect(breaker.getState()).toBe("HALF_OPEN");

      const successFn = vi.fn().mockResolvedValue("data");

      // 1st success in HALF_OPEN (successThreshold is 2)
      const res1 = await breaker.execute(successFn);
      expect(res1).toBe("data");
      expect(breaker.getState()).toBe("HALF_OPEN");
      expect(closeSpy).not.toHaveBeenCalled();

      // 2nd success in HALF_OPEN (reaches successThreshold of 2)
      const res2 = await breaker.execute(successFn);
      expect(res2).toBe("data");
      expect(breaker.getState()).toBe("CLOSED");
      expect(closeSpy).toHaveBeenCalledWith({ name: "payment-service" });
      expect(breaker.getMetrics().failures).toBe(0);
    });

    it("should transition HALF_OPEN -> OPEN immediately on a single failure", async () => {
      const openSpy = vi.fn();
      breaker.on("open", openSpy);

      breaker.forceTransition("HALF_OPEN");
      expect(breaker.getState()).toBe("HALF_OPEN");

      const failFn = vi.fn().mockRejectedValue(new Error("Probe failed"));
      await expect(breaker.execute(failFn)).rejects.toThrow("Probe failed");

      expect(breaker.getState()).toBe("OPEN");
      expect(openSpy).toHaveBeenCalledWith({ name: "payment-service" });
      expect(breaker.getMetrics().consecutiveSuccesses).toBe(0);
    });

    it("should reset all metrics, timers, and state to CLOSED on reset()", async () => {
      const resetSpy = vi.fn();
      breaker.on("reset", resetSpy);

      breaker.forceOpen();
      const failFn = vi.fn().mockRejectedValue(new Error("fail"));
      await expect(breaker.execute(failFn, () => "fallback")).resolves.toBe("fallback");

      expect(breaker.getMetrics().totalCalls).toBeGreaterThan(0);
      expect(breaker.getMetrics().rejectedCalls).toBeGreaterThan(0);

      breaker.reset();

      expect(breaker.getState()).toBe("CLOSED");
      expect(resetSpy).toHaveBeenCalledWith({ name: "payment-service" });
      const metrics = breaker.getMetrics();
      expect(metrics.failures).toBe(0);
      expect(metrics.successes).toBe(0);
      expect(metrics.consecutiveSuccesses).toBe(0);
      expect(metrics.totalCalls).toBe(0);
      expect(metrics.rejectedCalls).toBe(0);
      expect(metrics.lastFailureTime).toBeUndefined();

      // Advancing timer should not cause stray transitions
      await vi.advanceTimersByTimeAsync(2000);
      expect(breaker.getState()).toBe("CLOSED");
    });
  });

  describe("2. Threshold Boundary Tests (N-1 vs N failures)", () => {
    it("should stay CLOSED at exactly N-1 failures and trip on Nth failure", async () => {
      const failureSpy = vi.fn();
      breaker.on("failure", failureSpy);

      const failFn = vi.fn().mockRejectedValue(new Error("503 Service Unavailable"));

      // Failure 1 (N-2)
      await expect(breaker.execute(failFn)).rejects.toThrow("503 Service Unavailable");
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.getMetrics().failures).toBe(1);
      expect(failureSpy).toHaveBeenLastCalledWith({ name: "payment-service", failures: 1 });

      // Failure 2 (N-1 boundary)
      await expect(breaker.execute(failFn)).rejects.toThrow("503 Service Unavailable");
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.getMetrics().failures).toBe(2);
      expect(failureSpy).toHaveBeenLastCalledWith({ name: "payment-service", failures: 2 });

      // Failure 3 (N threshold met)
      await expect(breaker.execute(failFn)).rejects.toThrow("503 Service Unavailable");
      expect(breaker.getState()).toBe("OPEN");
      expect(breaker.getMetrics().failures).toBe(3);
      expect(failureSpy).toHaveBeenLastCalledWith({ name: "payment-service", failures: 3 });
    });

    it("should reset consecutiveSuccesses on error in CLOSED state", async () => {
      const successFn = vi.fn().mockResolvedValue("ok");
      const failFn = vi.fn().mockRejectedValue(new Error("err"));

      await breaker.execute(successFn);
      await breaker.execute(successFn);
      expect(breaker.getMetrics().consecutiveSuccesses).toBe(2);

      await expect(breaker.execute(failFn)).rejects.toThrow("err");
      expect(breaker.getMetrics().consecutiveSuccesses).toBe(0);
      expect(breaker.getMetrics().failures).toBe(1);
    });

    it("should ignore openCircuit/closeCircuit idempotent calls if already in that state", () => {
      breaker.forceClose();
      expect(breaker.getState()).toBe("CLOSED");
      breaker.forceClose(); // no-op
      expect(breaker.getState()).toBe("CLOSED");

      breaker.forceOpen();
      expect(breaker.getState()).toBe("OPEN");
      breaker.forceOpen(); // no-op
      expect(breaker.getState()).toBe("OPEN");
    });
  });

  describe("3. Half-Open Success, Failure & Max Calls Boundary", () => {
    it("should stay HALF_OPEN on M-1 successes and transition to CLOSED on Mth success", async () => {
      breaker.forceTransition("HALF_OPEN");

      const successFn = vi.fn().mockResolvedValue("probe-ok");

      // Success 1 (M-1)
      await breaker.execute(successFn);
      expect(breaker.getState()).toBe("HALF_OPEN");
      expect(breaker.getMetrics().consecutiveSuccesses).toBe(1);

      // Success 2 (M)
      await breaker.execute(successFn);
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.getMetrics().consecutiveSuccesses).toBe(0);
      expect(breaker.getMetrics().failures).toBe(0);
    });

    // TODO: fix tracked in https://github.com/SumitMahajan11/edge-cloud-orchestrator/issues/75
    // HALF_OPEN rejections increment rejectedCalls but do not emit("rejected"), unlike OPEN rejections.
    it.fails("should reject calls exceeding halfOpenMaxCalls in HALF_OPEN state", async () => {
      breaker.forceTransition("HALF_OPEN"); // halfOpenMaxCalls = 2

      // Create unresolved promises to simulate in-flight/consecutive probes
      let resolve1!: (val: string) => void;
      const slowFn1 = vi.fn().mockImplementation(() => new Promise<string>((res) => { resolve1 = res; }));
      let resolve2!: (val: string) => void;
      const slowFn2 = vi.fn().mockImplementation(() => new Promise<string>((res) => { resolve2 = res; }));

      const rejectedSpy = vi.fn();
      breaker.on("rejected", rejectedSpy);

      const call1 = breaker.execute(slowFn1);
      const call2 = breaker.execute(slowFn2);

      // 3rd call exceeds halfOpenMaxCalls (2)
      const call3Fn = vi.fn().mockResolvedValue("excess");
      await expect(breaker.execute(call3Fn)).rejects.toThrow(CircuitBreakerOpenError);
      expect(call3Fn).not.toHaveBeenCalled();
      expect(breaker.getMetrics().rejectedCalls).toBe(1);
      // BUG: this assertion fails — rejected event is not emitted for HALF_OPEN rejections
      expect(rejectedSpy).toHaveBeenCalledWith({ name: "payment-service" });

      // Resolve in-flight calls
      resolve1("ok1");
      resolve2("ok2");
      await Promise.all([call1, call2]);

      expect(breaker.getState()).toBe("CLOSED");
    });

    it("should reset halfOpenCalls and consecutiveSuccesses when forced into HALF_OPEN", () => {
      breaker.forceState("HALF_OPEN");
      expect(breaker.getState()).toBe("HALF_OPEN");
      expect(breaker.getMetrics().consecutiveSuccesses).toBe(0);
    });
  });

  describe("4. Fake Timers & Timeout Cleanup", () => {
    it("should correctly compute nextRetryAt in OPEN state", () => {
      const now = Date.now();
      breaker.forceOpen();
      const metrics = breaker.getMetrics();
      expect(metrics.nextRetryAt?.getTime()).toBe(now + 1000);
    });

    it("should clear pending reset timer when forceState is called", async () => {
      breaker.forceOpen();
      expect(breaker.getState()).toBe("OPEN");

      // Force to CLOSED before timer expires
      breaker.forceState("CLOSED");
      expect(breaker.getState()).toBe("CLOSED");

      // Advance time past original 1000ms
      await vi.advanceTimersByTimeAsync(1500);
      // Breaker should remain CLOSED and not transition to HALF_OPEN
      expect(breaker.getState()).toBe("CLOSED");
    });

    it("should re-arm timer when tripped back to OPEN from HALF_OPEN", async () => {
      breaker.forceOpen();
      await vi.advanceTimersByTimeAsync(1000);
      expect(breaker.getState()).toBe("HALF_OPEN");

      // Failure in HALF_OPEN trips back to OPEN
      const failFn = vi.fn().mockRejectedValue(new Error("fail"));
      await expect(breaker.execute(failFn)).rejects.toThrow("fail");
      expect(breaker.getState()).toBe("OPEN");

      // Wait 999ms (not half-open yet)
      await vi.advanceTimersByTimeAsync(999);
      expect(breaker.getState()).toBe("OPEN");

      // Wait 1ms more (1000ms elapsed since re-trip)
      await vi.advanceTimersByTimeAsync(1);
      expect(breaker.getState()).toBe("HALF_OPEN");
    });
  });

  describe("5. Concurrent Calls & Race Conditions", () => {
    it("should execute multiple concurrent calls successfully in CLOSED state", async () => {
      const fn = vi.fn().mockImplementation(async (id: number) => {
        return `result-${id}`;
      });

      const promises = Array.from({ length: 10 }, (_, i) => breaker.execute(() => fn(i)));
      const results = await Promise.all(promises);

      expect(results).toEqual([
        "result-0", "result-1", "result-2", "result-3", "result-4",
        "result-5", "result-6", "result-7", "result-8", "result-9",
      ]);
      expect(breaker.getMetrics().totalCalls).toBe(10);
      expect(breaker.getMetrics().successes).toBe(10);
      expect(breaker.getMetrics().rejectedCalls).toBe(0);
    });

    it("should reject all concurrent calls fast when in OPEN state", async () => {
      breaker.forceOpen();
      const fn = vi.fn().mockResolvedValue("ok");

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => breaker.execute(fn)),
      );

      for (const res of results) {
        expect(res.status).toBe("rejected");
        if (res.status === "rejected") {
          expect(res.reason).toBeInstanceOf(CircuitBreakerOpenError);
          expect(res.reason.circuitName).toBe("payment-service");
        }
      }
      expect(fn).not.toHaveBeenCalled();
      expect(breaker.getMetrics().rejectedCalls).toBe(5);
      expect(breaker.getMetrics().totalCalls).toBe(5);
    });

    it("should handle simultaneous failures and trip state cleanly", async () => {
      const failFn = vi.fn().mockRejectedValue(new Error("DB Down"));

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => breaker.execute(failFn)),
      );

      expect(breaker.getState()).toBe("OPEN");
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(5);
    });
  });

  describe("6. Error Propagation, Fallback & Event Emissions", () => {
    it("should propagate exact custom error class when execution fails", async () => {
      class CustomDatabaseError extends Error {
        public code: number;
        constructor(code: number) {
          super(`DB Error code: ${code}`);
          this.name = "CustomDatabaseError";
          this.code = code;
        }
      }

      const failFn = vi.fn().mockRejectedValue(new CustomDatabaseError(42));
      await expect(breaker.execute(failFn)).rejects.toThrow(CustomDatabaseError);
      await expect(breaker.execute(failFn)).rejects.toMatchObject({ code: 42 });
    });

    it("should return fallback on failure in CLOSED state if fallback provided", async () => {
      const failFn = vi.fn().mockRejectedValue(new Error("Timeout"));
      const fallback = vi.fn().mockReturnValue({ cached: true });

      const result = await breaker.execute(failFn, fallback);
      expect(result).toEqual({ cached: true });
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(breaker.getMetrics().failures).toBe(1);
    });

    it("should return fallback in OPEN state without calling fn", async () => {
      breaker.forceOpen();
      const fn = vi.fn().mockResolvedValue("real data");
      const fallback = vi.fn().mockReturnValue("fallback response");

      const rejectedSpy = vi.fn();
      breaker.on("rejected", rejectedSpy);

      const result = await breaker.execute(fn, fallback);
      expect(result).toBe("fallback response");
      expect(fn).not.toHaveBeenCalled();
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(rejectedSpy).toHaveBeenCalledWith({ name: "payment-service" });
    });

    it("should emit success event with circuit name", async () => {
      const successSpy = vi.fn();
      breaker.on("success", successSpy);

      await breaker.execute(async () => 123);
      expect(successSpy).toHaveBeenCalledWith({ name: "payment-service" });
    });
  });

  describe("7. CircuitBreakerRegistry", () => {
    let registry: CircuitBreakerRegistry;

    beforeEach(() => {
      registry = new CircuitBreakerRegistry();
    });

    it("should create new breaker and return cached instance on subsequent getOrCreate", () => {
      const breaker1 = registry.getOrCreate("auth-service", { failureThreshold: 5 });
      expect(breaker1).toBeDefined();
      expect(breaker1.getState()).toBe("CLOSED");

      const breaker2 = registry.getOrCreate("auth-service");
      expect(breaker2).toBe(breaker1);
      expect(registry.get("auth-service")).toBe(breaker1);
    });

    it("should return undefined for non-existent breaker in get()", () => {
      expect(registry.get("non-existent")).toBeUndefined();
    });

    it("should return map copy in getAll() and delete via remove()", () => {
      registry.getOrCreate("svc-a");
      registry.getOrCreate("svc-b");

      const all = registry.getAll();
      expect(all.size).toBe(2);
      expect(all.has("svc-a")).toBe(true);
      expect(all.has("svc-b")).toBe(true);

      const removed = registry.remove("svc-a");
      expect(removed).toBe(true);
      expect(registry.get("svc-a")).toBeUndefined();
      expect(registry.remove("svc-a")).toBe(false);
    });

    it("should provide healthCheck and getAllMetrics", () => {
      registry.getOrCreate("svc-1");
      const b2 = registry.getOrCreate("svc-2");
      b2.forceOpen();

      const health = registry.healthCheck();
      expect(health["svc-1"].state).toBe("CLOSED");
      expect(health["svc-2"].state).toBe("OPEN");

      const allMetrics = registry.getAllMetrics();
      expect(allMetrics).toEqual(health);
    });

    it("should reset all breakers on resetAll()", () => {
      const b1 = registry.getOrCreate("svc-1");
      const b2 = registry.getOrCreate("svc-2");
      b1.forceOpen();
      b2.forceOpen();

      registry.resetAll();

      expect(b1.getState()).toBe("CLOSED");
      expect(b2.getState()).toBe("CLOSED");
    });

    it("should return structured state list for UI in getAllStates()", async () => {
      const b = registry.getOrCreate("api-gateway");
      const failFn = vi.fn().mockRejectedValue(new Error("Network Error"));
      await expect(b.execute(failFn)).rejects.toThrow();

      const states = registry.getAllStates();
      expect(states).toHaveLength(1);
      expect(states[0].name).toBe("api-gateway");
      expect(states[0].state).toBe("CLOSED");
      expect(states[0].failureCount).toBe(1);
      expect(states[0].failureRate).toBe(100);
      expect(states[0].lastStateChange).toBeDefined();
    });

    it("should allow forcing state on existing or newly created breaker via forceState", () => {
      registry.forceState("dynamic-svc", "OPEN");
      const breaker = registry.get("dynamic-svc");
      expect(breaker).toBeDefined();
      expect(breaker?.getState()).toBe("OPEN");
    });
  });

  describe("8. RedisCircuitBreakerSync (Unit Only, 0 Network)", () => {
    let mockRedis: any;
    let mockSubscriber: any;
    let registry: CircuitBreakerRegistry;
    let sync: RedisCircuitBreakerSync;

    beforeEach(() => {
      mockRedis = {
        setex: vi.fn().mockResolvedValue("OK"),
        publish: vi.fn().mockResolvedValue(1),
        keys: vi.fn().mockResolvedValue([]),
        get: vi.fn(),
      };
      mockSubscriber = {
        subscribe: vi.fn().mockResolvedValue("OK"),
        on: vi.fn(),
      };
      registry = new CircuitBreakerRegistry();
      sync = new RedisCircuitBreakerSync(mockRedis);
    });

    it("should publish state changes with metadata and TTL", async () => {
      const date = new Date("2026-10-01T12:00:00Z");
      await sync.publishStateChange("order-service", "OPEN", {
        failureRate: 75.5,
        lastFailureAt: date,
      });

      expect(mockRedis.setex).toHaveBeenCalledWith(
        "circuit_breaker:state:order-service",
        300,
        expect.stringContaining('"breakerName":"order-service"'),
      );
      expect(mockRedis.publish).toHaveBeenCalledWith(
        "circuit_breaker:state_change",
        expect.stringContaining('"newState":"OPEN"'),
      );
    });

    it("should sync multiple states from Redis keys on startup", async () => {
      mockRedis.keys.mockResolvedValue([
        "circuit_breaker:state:svc-1",
        "circuit_breaker:state:svc-2",
      ]);
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key.includes("svc-1")) {
          return JSON.stringify({ breakerName: "svc-1", state: "OPEN" });
        }
        if (key.includes("svc-2")) {
          return JSON.stringify({ breakerName: "svc-2", state: "HALF_OPEN" });
        }
        return null;
      });

      await sync.syncStateFromRedis(registry);

      expect(registry.get("svc-1")?.getState()).toBe("OPEN");
      expect(registry.get("svc-2")?.getState()).toBe("HALF_OPEN");
    });

    it("should ignore empty or invalid JSON keys during sync without crashing", async () => {
      mockRedis.keys.mockResolvedValue([
        "circuit_breaker:state:empty-key",
        "circuit_breaker:state:bad-json",
      ]);
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key.includes("empty-key")) {
          return null;
        }
        if (key.includes("bad-json")) {
          return "{invalid-json";
        }
        return null;
      });

      await expect(sync.syncStateFromRedis(registry)).resolves.not.toThrow();
      expect(registry.get("empty-key")).toBeUndefined();
      expect(registry.get("bad-json")).toBeUndefined();
    });

    it("should subscribe to state change messages and update registry", async () => {
      let messageHandler!: (channel: string, message: string) => void;
      mockSubscriber.on.mockImplementation((event: string, handler: any) => {
        if (event === "message") {
          messageHandler = handler;
        }
      });

      await sync.subscribeToStateChanges(registry, mockSubscriber);
      expect(mockSubscriber.subscribe).toHaveBeenCalledWith("circuit_breaker:state_change");
      expect(messageHandler).toBeDefined();

      // Send message for unknown channel (ignored)
      messageHandler("other:channel", JSON.stringify({ breakerName: "node-svc", newState: "OPEN" }));
      expect(registry.get("node-svc")).toBeUndefined();

      // Create initial breaker in CLOSED
      const breaker = registry.getOrCreate("node-svc");
      expect(breaker.getState()).toBe("CLOSED");

      // Send valid update
      messageHandler(
        "circuit_breaker:state_change",
        JSON.stringify({ breakerName: "node-svc", newState: "OPEN" }),
      );
      expect(breaker.getState()).toBe("OPEN");

      // Send invalid JSON message (handled gracefully)
      expect(() => {
        messageHandler("circuit_breaker:state_change", "corrupt-json");
      }).not.toThrow();
    });
  });
});
