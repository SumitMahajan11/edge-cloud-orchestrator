import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CircuitBreaker } from "../circuit-breaker";
import { RetryExhaustedError, RetryPolicy, withRetry } from "../retry";

describe("RetryPolicy Unit Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Basic Execution & Success", () => {
    it("should execute function successfully on first attempt without retry", async () => {
      const policy = new RetryPolicy({ maxAttempts: 3 });
      const fn = vi.fn().mockResolvedValue("hello");

      const result = await policy.execute(fn);

      expect(result).toBe("hello");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry and recover on transient errors", async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 100,
        jitterType: "none",
      });

      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce("recovered");

      const onRetry = vi.fn();
      policy.on("retry", onRetry);
      const recoveredSpy = vi.fn();
      policy.on("recovered", recoveredSpy);

      const promise = policy.execute(fn);

      // Advance timers past delay
      await vi.advanceTimersByTimeAsync(150);

      const result = await promise;
      expect(result).toBe("recovered");
      expect(fn).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledWith(
        expect.objectContaining({ attempt: 1, delay: 100, nextAttempt: 2 }),
      );
      expect(recoveredSpy).toHaveBeenCalledWith(
        expect.objectContaining({ attempt: 2 }),
      );
    });

    it("should throw RetryExhaustedError when maxAttempts is reached", async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 50,
        jitterType: "none",
      });

      const fn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      const exhaustedSpy = vi.fn();
      policy.on("exhausted", exhaustedSpy);

      const promise = policy.execute(fn);
      const assertion = expect(promise).rejects.toThrow(RetryExhaustedError);

      await vi.advanceTimersByTimeAsync(500);

      await assertion;
      expect(fn).toHaveBeenCalledTimes(3);
      expect(exhaustedSpy).toHaveBeenCalled();
    });
  });

  describe("Jitter & Delay Calculations", () => {
    it("should support 'none' jitter (pure exponential backoff)", async () => {
      const policy = new RetryPolicy({
        maxAttempts: 4,
        initialDelay: 100,
        backoffMultiplier: 2,
        maxDelay: 1000,
        jitterType: "none",
      });

      const delays: number[] = [];
      policy.on("retry", ({ delay }) => delays.push(delay));

      const fn = vi.fn().mockRejectedValue(new Error("TimeoutError"));
      const promise = policy.execute(fn);
      const assertion = expect(promise).rejects.toThrow(RetryExhaustedError);

      await vi.advanceTimersByTimeAsync(2000);

      await assertion;
      expect(delays).toEqual([100, 200, 400]);
    });

    it("should support 'full' jitter (randomized up to exponential delay)", async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 100,
        backoffMultiplier: 2,
        jitterType: "full",
      });

      const delays: number[] = [];
      policy.on("retry", ({ delay }) => delays.push(delay));

      const fn = vi.fn().mockRejectedValue(new Error("NetworkError"));
      const promise = policy.execute(fn);
      const assertion = expect(promise).rejects.toThrow(RetryExhaustedError);

      await vi.advanceTimersByTimeAsync(2000);

      await assertion;
      expect(delays).toHaveLength(2);
      expect(delays[0]).toBeGreaterThanOrEqual(0);
      expect(delays[0]).toBeLessThanOrEqual(100);
      expect(delays[1]).toBeGreaterThanOrEqual(0);
      expect(delays[1]).toBeLessThanOrEqual(200);
    });

    it("should support 'equal' jitter", async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 100,
        backoffMultiplier: 2,
        jitterType: "equal",
      });

      const delays: number[] = [];
      policy.on("retry", ({ delay }) => delays.push(delay));

      const fn = vi.fn().mockRejectedValue(new Error("ETIMEDOUT"));
      const promise = policy.execute(fn);
      const assertion = expect(promise).rejects.toThrow(RetryExhaustedError);

      await vi.advanceTimersByTimeAsync(2000);

      await assertion;
      expect(delays).toHaveLength(2);
      expect(delays[0]).toBeGreaterThanOrEqual(50);
      expect(delays[0]).toBeLessThanOrEqual(100);
    });

    it("should support 'decorrelated' jitter", async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 100,
        backoffMultiplier: 2,
        maxDelay: 500,
        jitterType: "decorrelated",
      });

      const delays: number[] = [];
      policy.on("retry", ({ delay }) => delays.push(delay));

      const fn = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
      const promise = policy.execute(fn);
      const assertion = expect(promise).rejects.toThrow(RetryExhaustedError);

      await vi.advanceTimersByTimeAsync(2000);

      await assertion;
      expect(delays).toHaveLength(2);
      expect(delays[0]).toBeLessThanOrEqual(500);
      expect(delays[1]).toBeLessThanOrEqual(500);
    });
  });

  describe("Custom Filters & Retry Conditions", () => {
    it("should not retry non-retryable errors by default", async () => {
      const policy = new RetryPolicy({ maxAttempts: 3 });
      const fn = vi.fn().mockRejectedValue(new Error("Validation Error: Invalid input"));

      await expect(policy.execute(fn)).rejects.toThrow(RetryExhaustedError);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should respect custom shouldRetry predicate", async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 50,
        jitterType: "none",
        shouldRetry: (err) => err.message.includes("CustomRetryable"),
      });

      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("CustomRetryable error"))
        .mockResolvedValueOnce("custom-recovered");

      const promise = policy.execute(fn);
      await vi.advanceTimersByTimeAsync(100);

      const res = await promise;
      expect(res).toBe("custom-recovered");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should respect retryableErrors string list", async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 50,
        jitterType: "none",
        retryableErrors: ["ServiceUnavailableException"],
      });

      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("ServiceUnavailableException: Backend busy"))
        .mockResolvedValueOnce("ok");

      const promise = policy.execute(fn);
      await vi.advanceTimersByTimeAsync(100);

      const res = await promise;
      expect(res).toBe("ok");
    });

    it("should invoke onRetry callback if configured", async () => {
      const onRetry = vi.fn();
      const policy = new RetryPolicy({
        maxAttempts: 2,
        initialDelay: 50,
        jitterType: "none",
        onRetry,
      });

      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce("success");

      const promise = policy.execute(fn);
      await vi.advanceTimersByTimeAsync(100);

      await promise;
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), 50);
    });
  });

  describe("Retry Budget", () => {
    it("should exhaust retry budget and throw error when limit is reached", async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 10,
        jitterType: "none",
        retryBudget: {
          maxRetriesPerWindow: 2,
          windowMs: 1000,
        },
      });

      const budgetExhaustedSpy = vi.fn();
      policy.on("budget_exhausted", budgetExhaustedSpy);

      // 1st operation: takes 1 retry (attempt 1 fail, attempt 2 success => retryCount = 1)
      const fn1 = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce("ok1");
      const p1 = policy.execute(fn1);
      await vi.advanceTimersByTimeAsync(100);
      await expect(p1).resolves.toBe("ok1");

      // 2nd operation: attempts 1 fail, then on retry attempt 2 retryCount becomes 2 which meets maxRetriesPerWindow, throwing budget exhausted
      const fn2 = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
      const p2 = policy.execute(fn2);
      const assertion2 = expect(p2).rejects.toThrow("Retry budget exhausted");
      await vi.advanceTimersByTimeAsync(100);
      await assertion2;
      expect(budgetExhaustedSpy).toHaveBeenCalled();

      // Advance windowMs
      await vi.advanceTimersByTimeAsync(1000);

      // 3rd operation: budget should reset after window expires
      const fn3 = vi.fn().mockResolvedValue("ok3");
      await expect(policy.execute(fn3)).resolves.toBe("ok3");
    });
  });

  describe("Circuit Breaker Integration", () => {
    it("should fail fast if attached circuit breaker is OPEN", async () => {
      const breaker = new CircuitBreaker();
      breaker.forceOpen();

      const policy = new RetryPolicy({ circuitBreaker: breaker });
      const fn = vi.fn().mockResolvedValue("ok");

      await expect(policy.execute(fn)).rejects.toThrow("Circuit breaker 'retry-policy' is OPEN");
      expect(fn).not.toHaveBeenCalled();
    });

    it("should record success on circuit breaker on operation success", async () => {
      const breaker = new CircuitBreaker();
      const policy = new RetryPolicy({ circuitBreaker: breaker });

      await policy.execute(async () => "val");
      expect(breaker.getMetrics().successes).toBe(1);
    });
  });

  describe("withRetry Decorator", () => {
    it("should retry decorated class methods", async () => {
      class ServiceClient {
        public attempts = 0;

        async fetchData(): Promise<string> {
          this.attempts++;
          if (this.attempts < 2) {
            throw new Error("ETIMEDOUT");
          }
          return "decorated-data";
        }
      }

      const client = new ServiceClient();
      const desc = Object.getOwnPropertyDescriptor(ServiceClient.prototype, "fetchData")!;
      withRetry({ maxAttempts: 3, initialDelay: 10, jitterType: "none" })(
        ServiceClient.prototype,
        "fetchData",
        desc,
      );
      Object.defineProperty(ServiceClient.prototype, "fetchData", desc);

      const promise = client.fetchData();
      await vi.advanceTimersByTimeAsync(50);

      const result = await promise;
      expect(result).toBe("decorated-data");
      expect(client.attempts).toBe(2);
    });
  });
});
