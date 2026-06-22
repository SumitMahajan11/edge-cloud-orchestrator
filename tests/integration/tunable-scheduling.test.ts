import { Redis } from "ioredis";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TaskScheduler } from "../../apps/api/src/services/task-scheduler";
import { setupTestApp, teardownTestApp } from "./helpers";

describe("Tunable Scheduling Policy Integration", () => {
  let context: any;
  let prisma: any;
  let redis: Redis;
  let scheduler: TaskScheduler;
  let tenantId: string;
  let accessToken: string;

  beforeAll(async () => {
    context = await setupTestApp();
    prisma = context.prisma;
    accessToken = context.accessToken;
    tenantId = context.tenantId;
    redis = (context.app as any).redis;

    // Stop background scheduler to avoid resource contention and race conditions
    if ((context.app as any).taskScheduler) {
      (context.app as any).taskScheduler.stop();
    }

    const logger = pino({ level: "debug" });
    const wsManager = {
      broadcastToTenant: () => {},
      broadcast: () => {},
    } as any;

    scheduler = new TaskScheduler(prisma, redis, wsManager, logger);
    (scheduler as any).isRunning = true;
    (scheduler as any).leaderElection = {
      isCurrentlyLeader: () => true,
      start: async () => {},
      stop: async () => {},
    } as any;
  });

  afterAll(async () => {
    try {
      await prisma.taskExecution.deleteMany({ where: { tenantId } });
    } catch {}
    try {
      await (prisma as any).schedulingDecision.deleteMany({ where: { tenantId } });
    } catch {}
    try {
      await prisma.task.deleteMany({ where: { tenantId } });
    } catch {}
    try {
      await prisma.schedulingPolicy.deleteMany({ where: { tenantId } });
    } catch {}
    try {
      await prisma.edgeNode.deleteMany({ where: { tenantId } });
    } catch {}
    try {
      if (redis && typeof redis.quit === "function") {
        await redis.quit();
      }
    } catch {}
    await teardownTestApp(context);
  });

  it("should return a default policy if none is created yet", async () => {
    const res = await context.app.inject({
      method: "GET",
      url: "/v2/scheduling/policy",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Tenant-ID": tenantId,
      },
    });

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.payload);
    expect(payload.isActive).toBe(true);
    expect(payload.config.latencyWeight).toBeCloseTo(0.33);
    expect(payload.config.costWeight).toBeCloseTo(0.33);
    expect(payload.config.carbonWeight).toBeCloseTo(0.34);
  });

  it("should fail to set weights if they do not sum to 1.0", async () => {
    const res = await context.app.inject({
      method: "PUT",
      url: "/v2/scheduling/policy",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Tenant-ID": tenantId,
      },
      payload: {
        latencyWeight: 0.5,
        costWeight: 0.5,
        carbonWeight: 0.5, // sums to 1.5, should fail validation
      },
    });

    expect(res.statusCode).toBe(400);
    const payload = JSON.parse(res.payload);
    expect(payload.message).toContain("Weights must sum to 1.0");
  });

  it("should successfully set weights when they sum to 1.0, cache in Redis, and apply them in scheduling", async () => {
    // 1. Set policy weights to minimize cost (costWeight = 1.0)
    const putRes = await context.app.inject({
      method: "PUT",
      url: "/v2/scheduling/policy",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Tenant-ID": tenantId,
      },
      payload: {
        latencyWeight: 0.0,
        costWeight: 1.0,
        carbonWeight: 0.0,
      },
    });

    expect(putRes.statusCode).toBe(200);
    const policyPayload = JSON.parse(putRes.payload);
    expect(policyPayload.success).toBe(true);
    expect(policyPayload.policy.config.costWeight).toBe(1.0);

    // Verify Redis cache key is invalidated or deleted (should be absent or set to the new value if fetched)
    const cacheKey = `tenant:policy:${tenantId}`;
    const cached = await redis.get(cacheKey);
    expect(cached).toBeNull(); // Invalidation deletes the key

    // 2. Create nodes with contrasting stats:
    // Node A (Low Latency, High Cost, High Carbon)
    const nodeA = await prisma.edgeNode.create({
      data: {
        name: "Low Latency Node A",
        status: "ONLINE",
        location: "US",
        region: "us-east-1",
        ipAddress: "10.0.0.1",
        port: 8081,
        url: "http://10.0.0.1:8081",
        cpuCores: 8,
        memoryGB: 16,
        storageGB: 100,
        latency: 10,
        costPerHour: 5.0,
        carbonIntensity: 500,
        tenantId,
      },
    });

    // Node B (High Latency, Low Cost, Low Carbon)
    const nodeB = await prisma.edgeNode.create({
      data: {
        name: "Eco-Friendly Low Cost Node B",
        status: "ONLINE",
        location: "US",
        region: "us-east-1",
        ipAddress: "10.0.0.2",
        port: 8082,
        url: "http://10.0.0.2:8082",
        cpuCores: 8,
        memoryGB: 16,
        storageGB: 100,
        latency: 200,
        costPerHour: 0.5,
        carbonIntensity: 50,
        tenantId,
      },
    });

    // 3. Create a task and schedule it with ML-optimized policy
    const task = await prisma.task.create({
      data: {
        name: "Test Tunable Task",
        type: "COMPUTE",
        status: "PENDING",
        priority: "MEDIUM",
        target: "EDGE",
        policy: "ml-optimized",
        reason: "test-tuning",
        tenantId,
      },
    });

    // Enqueue task to the scheduler's Redis queue
    await scheduler.enqueue(task as any);

    // Run scheduler process queue (which calls findNode internally)
    await scheduler.processQueue();

    // Verify task was assigned to Node B because weight was 100% on Cost
    const scheduledTask = await prisma.task.findUnique({
      where: { id: task.id },
    });
    expect(scheduledTask?.status).toBe("SCHEDULED");
    expect(scheduledTask?.nodeId).toBe(nodeB.id);

    // 4. Update policy weights to prioritize latency (latencyWeight = 1.0)
    const putRes2 = await context.app.inject({
      method: "PUT",
      url: "/v2/scheduling/policy",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Tenant-ID": tenantId,
      },
      payload: {
        latencyWeight: 1.0,
        costWeight: 0.0,
        carbonWeight: 0.0,
      },
    });
    expect(putRes2.statusCode).toBe(200);

    // Create a new task
    const task2 = await prisma.task.create({
      data: {
        name: "Test Tunable Task 2",
        type: "COMPUTE",
        status: "PENDING",
        priority: "MEDIUM",
        target: "EDGE",
        policy: "ml-optimized",
        reason: "test-tuning-2",
        tenantId,
      },
    });

    // Enqueue task 2 to the scheduler's Redis queue
    await scheduler.enqueue(task2 as any);

    // Run scheduler process queue
    await scheduler.processQueue();

    // Verify task2 was assigned to Node A because weight was 100% on Latency
    const scheduledTask2 = await prisma.task.findUnique({
      where: { id: task2.id },
    });
    expect(scheduledTask2?.status).toBe("SCHEDULED");
    expect(scheduledTask2?.nodeId).toBe(nodeA.id);
  });
});
