import { Redis } from "ioredis";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TaskScheduler } from "../../apps/api/src/services/task-scheduler";
import { WebSocketManager } from "../../apps/api/src/services/websocket-manager";
import { setupTestApp, teardownTestApp } from "./helpers";

describe("Scheduling Race Condition", () => {
  let prisma: any;
  let redis: Redis;
  let scheduler: TaskScheduler;
  let tenantId: string;
  let context: any;

  beforeAll(async () => {
    context = await setupTestApp();
    prisma = context.prisma;
    const { createMockRedis } =
      await import("../../apps/api/src/initializers/mock-redis");
    const logger = pino({ level: "silent" });
    redis = createMockRedis(logger) as any;
    const wsManager = {} as any; // Mock

    scheduler = new TaskScheduler(prisma, redis, wsManager, logger);

    // Setup tenant
    const tenant = await prisma.tenant.create({
      data: { name: "Race Test Tenant", slug: "race-test", config: "{}" },
    });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { tenantId } });
    await prisma.edgeNode.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await redis.quit();
    await teardownTestApp(context);
  });

  it("should not over-assign tasks under heavy concurrency", async () => {
    // 1. Create a node with capacity 5
    const node = await prisma.edgeNode.create({
      data: {
        name: "Race Node",
        status: "ONLINE",
        location: "US",
        region: "us-east-1",
        ipAddress: "127.0.0.1",
        port: 8080,
        url: "http://127.0.0.1:8080",
        cpuCores: 4,
        memoryGB: 8,
        storageGB: 100,
        maxTasks: 5,
        tenantId,
      },
    });

    // 2. Submit 20 tasks concurrently
    const taskPromises = Array.from({ length: 20 }).map((_, i) =>
      prisma.task.create({
        data: {
          name: `Task ${i}`,
          type: "COMPUTE",
          status: "PENDING",
          priority: "MEDIUM",
          target: "EDGE",
          policy: "latency-aware",
          reason: "test",
          tenantId,
        },
      }),
    );
    const tasks = await Promise.all(taskPromises);

    // 3. Trigger concurrent scheduling
    // Since processQueue is usually called in a loop, we'll simulate concurrent calls
    const schedulingPromises = Array.from({ length: 10 }).map(() =>
      scheduler.processQueue(),
    );

    await Promise.all(schedulingPromises);

    // 4. Verify results
    const updatedNode = await prisma.edgeNode.findUnique({
      where: { id: node.id },
    });

    const assignedTasks = await prisma.task.count({
      where: { nodeId: node.id, status: "SCHEDULED" },
    });

    expect(updatedNode?.tasksRunning).toBeLessThanOrEqual(5);
    expect(assignedTasks).toBeLessThanOrEqual(5);
    expect(updatedNode?.tasksRunning).toBe(assignedTasks);
  });
});
