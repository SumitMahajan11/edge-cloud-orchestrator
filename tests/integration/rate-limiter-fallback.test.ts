import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { setupTestApp, teardownTestApp, TestContext } from "./helpers.js";
import { SchedulerRateLimiter } from "../../apps/api/src/services/scheduler-rate-limiter.js";

describe("SchedulerRateLimiter Fallback Integration", () => {
  let ctx: TestContext;
  let rateLimiter: SchedulerRateLimiter;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  beforeEach(() => {
    rateLimiter = (ctx.app as any).schedulerRateLimiter;
    // Reset rate limiter to healthy state
    (rateLimiter as any).redisAvailable = true;
    if ((rateLimiter as any).recoveryTimer) {
      clearTimeout((rateLimiter as any).recoveryTimer);
      (rateLimiter as any).recoveryTimer = null;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  it("should switch to fallback mode when Redis calls fail", async () => {
    // 1. Verify initially healthy
    expect(rateLimiter.isDegraded()).toBe(false);

    // 2. Mock Redis failure
    // Inject failure into Redis
    vi.spyOn(ctx.app.redis, "get").mockRejectedValue(
      new Error("Redis Connection Lost"),
    );
    vi.spyOn(ctx.app.redis, "ping").mockRejectedValue(
      new Error("Redis Connection Lost"),
    );

    // 3. Trigger a rate limit check which should fail and trigger fallback
    const result = await rateLimiter.checkRateLimit(
      "task-1",
      "user-1",
      "node-1",
    );

    expect(result.allowed).toBe(true); // Fail open
    expect(result.degraded).toBe(true);
    expect(rateLimiter.isDegraded()).toBe(true);

    // 4. Verify API header is present
    const response = await ctx.app.inject({
      method: "GET",
      url: "/v1/tasks",
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });

    expect(response.headers["x-ratelimit-mode"]).toBe("degraded");
  });

  it("should recover when Redis comes back online", async () => {
    // Force failure
    vi.spyOn(ctx.app.redis, "get").mockRejectedValue(
      new Error("Redis connection lost"),
    );
    vi.spyOn(ctx.app.redis, "ping").mockRejectedValue(
      new Error("Redis connection lost"),
    );

    // Trigger failure
    await rateLimiter.checkRateLimit("test-task", "test-user", "test-node");

    // Wait for at least one health check cycle
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(rateLimiter.isDegraded()).toBe(true);

    // Restore Redis
    vi.restoreAllMocks();

    // Wait for recovery check (interval is 5s, so wait slightly more)
    await new Promise((resolve) => setTimeout(resolve, 5500));

    expect(rateLimiter.isDegraded()).toBe(false);

    // 4. Verify API header is gone
    const response = await ctx.app.inject({
      method: "GET",
      url: "/v1/tasks",
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });

    expect(response.headers["x-ratelimit-mode"]).toBeUndefined();
  }, 15000);

  it("should enforce conservative limits in fallback mode", async () => {
    // 1. Force degraded state
    (rateLimiter as any).redisAvailable = false;

    // 2. Exhaust conservative node limit (10 tasks/min)
    const userId = "user-test";
    const nodeId = "node-test";

    for (let i = 0; i < 10; i++) {
      const res = await rateLimiter.checkRateLimit(`task-${i}`, userId, nodeId);
      expect(res.allowed).toBe(true);
    }

    // 11th request should be rejected
    const finalRes = await rateLimiter.checkRateLimit(
      "task-11",
      userId,
      nodeId,
    );
    expect(finalRes.allowed).toBe(false);
    expect(finalRes.reason).toContain("Fallback Mode");
  });
});
