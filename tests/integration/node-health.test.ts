import { Redis } from "ioredis";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { TaskScheduler } from "../../apps/api/src/services/task-scheduler";
import { NodeHealthScorer } from "../../apps/api/src/services/node-health-scorer";
import { setupTestApp, teardownTestApp } from "./helpers";

describe("Anomaly-Aware Self-Healing Scheduler Integration", () => {
  let context: any;
  let prisma: any;
  let redis: Redis;
  let scheduler: TaskScheduler;
  let tenantId: string;
  const broadcastEvents: any[] = [];

  beforeAll(async () => {
    context = await setupTestApp();
    prisma = context.prisma;
    tenantId = context.tenantId;
    redis = (context.app).redis;

    if ((context.app).taskScheduler) {
      (context.app).taskScheduler.stop();
    }

    const logger = pino({ level: "silent" });
    const wsManager = {
      broadcast: (event: string, payload: any, tId: string) => {
        broadcastEvents.push({ tenantId: tId, event, payload });
      },
      broadcastToTenant: () => {},
    } as any;

    scheduler = new TaskScheduler(prisma, redis, wsManager, logger);
    (scheduler as any).isRunning = true;
    (scheduler as any).leaderElection = {
      isCurrentlyLeader: () => true,
      start: async () => {},
      stop: async () => {},
    } as any;
  });

  beforeEach(async () => {
    broadcastEvents.length = 0;
    try {
      await prisma.nodeHealthScore.deleteMany({ where: { tenantId } });
    } catch {}
    try {
      await prisma.taskExecution.deleteMany({ where: { tenantId } });
    } catch {}
    try {
      await prisma.task.deleteMany({ where: { tenantId } });
    } catch {}
    try {
      await prisma.edgeNode.deleteMany({ where: { tenantId } });
    } catch {}
  });

  afterAll(async () => {
    try {
      await prisma.nodeHealthScore.deleteMany({ where: { tenantId } });
    } catch {}
    try {
      await prisma.taskExecution.deleteMany({ where: { tenantId } });
    } catch {}
    try {
      await prisma.task.deleteMany({ where: { tenantId } });
    } catch {}
    try {
      await prisma.edgeNode.deleteMany({ where: { tenantId } });
    } catch {}
    await teardownTestApp(context);
  });

  it("should record success and failure task outcomes and update EMA health scorer metrics", async () => {
    // 1. Create a node
    const node = await prisma.edgeNode.create({
      data: {
        name: "Health Test Node",
        status: "ONLINE",
        location: "US",
        region: "us-east-1",
        ipAddress: "10.0.0.10",
        port: 8085,
        url: "http://10.0.0.10:8085",
        cpuCores: 4,
        memoryGB: 8,
        storageGB: 50,
        latency: 50,
        costPerHour: 1.0,
        carbonIntensity: 100,
        tenantId,
      },
    });

    // 2. Create a task
    const task1 = await prisma.task.create({
      data: {
        name: "Task 1",
        type: "COMPUTE",
        status: "PENDING",
        priority: "MEDIUM",
        target: "EDGE",
        policy: "ml-optimized",
        reason: "health-test-1",
        tenantId,
      },
    });

    // 3. Simulate completion (success)
    await scheduler.handleTaskCompletion(task1.id, node.id, {
      status: "completed",
      duration: 100,
    });

    // Verify a NodeHealthScore was created
    let scoreRecord = await prisma.nodeHealthScore.findUnique({
      where: { nodeId: node.id },
    });
    expect(scoreRecord).toBeDefined();
    expect(scoreRecord?.successRate).toBeCloseTo(1.0);
    expect(scoreRecord?.avgLatencyMs).toBeCloseTo(100);
    expect(scoreRecord?.isAnomaly).toBe(false);
    expect(scoreRecord?.penaltyMultiplier).toBe(1.0);

    // 4. Simulate a failure outcome
    const task2 = await prisma.task.create({
      data: {
        name: "Task 2",
        type: "COMPUTE",
        status: "PENDING",
        priority: "MEDIUM",
        target: "EDGE",
        policy: "ml-optimized",
        reason: "health-test-2",
        tenantId,
      },
    });

    await scheduler.handleTaskCompletion(task2.id, node.id, {
      status: "failed",
      error: "Timeout occurred",
      duration: 200,
    });

    scoreRecord = await prisma.nodeHealthScore.findUnique({
      where: { nodeId: node.id },
    });
    // With EMA window=100, alpha = 2/(100+1) = 0.0198
    // New Success Rate = 1.0 * (1 - 0.0198) + 0.0 * 0.0198 = ~0.9802
    expect(scoreRecord?.successRate).toBeLessThan(1.0);
    expect(scoreRecord?.successRate).toBeCloseTo(0.98, 2);
  });

  it("should trigger an anomaly state when success rate drops below 85%", async () => {
    const node = await prisma.edgeNode.create({
      data: {
        name: "Degraded Node",
        status: "ONLINE",
        location: "US",
        region: "us-east-1",
        ipAddress: "10.0.0.11",
        port: 8086,
        url: "http://10.0.0.11:8086",
        cpuCores: 4,
        memoryGB: 8,
        storageGB: 50,
        latency: 50,
        costPerHour: 1.0,
        carbonIntensity: 100,
        tenantId,
      },
    });

    const healthScorer: NodeHealthScorer = (scheduler as any).nodeHealthScorer;
    
    // Send 10 failures to node
    for (let i = 0; i < 10; i++) {
      await healthScorer.recordTaskOutcome(node.id, tenantId, "FAILED", 150);
    }

    const scoreRecord = await prisma.nodeHealthScore.findUnique({
      where: { nodeId: node.id },
    });
    
    expect(scoreRecord?.isAnomaly).toBe(true);
    expect(scoreRecord?.penaltyMultiplier).toBeLessThan(1.0);

    // Verify WebSocket event was broadcast
    const anomalyEvent = broadcastEvents.find(
      (e) => e.event === "node:anomaly-detected" && e.payload.nodeId === node.id
    );
    expect(anomalyEvent).toBeDefined();
    expect(anomalyEvent.payload.successRate).toBeLessThan(0.85);
  });

  it("should scale scheduler score and deprioritize anomaly nodes", async () => {
    // Node A is healthy (costPerHour=2.0, latency=50)
    const nodeHealthy = await prisma.edgeNode.create({
      data: {
        name: "Healthy Node A",
        status: "ONLINE",
        location: "US",
        region: "us-east-1",
        ipAddress: "10.0.0.12",
        port: 8087,
        url: "http://10.0.0.12:8087",
        cpuCores: 4,
        memoryGB: 8,
        storageGB: 50,
        latency: 60,
        costPerHour: 2.0,
        carbonIntensity: 100,
        tenantId,
      },
    });

    // Node B has better cost/latency (costPerHour=0.5, latency=30) but is in anomaly (penaltyMultiplier = 0.2)
    const nodeDegraded = await prisma.edgeNode.create({
      data: {
        name: "Degraded Node B",
        status: "ONLINE",
        location: "US",
        region: "us-east-1",
        ipAddress: "10.0.0.13",
        port: 8088,
        url: "http://10.0.0.13:8088",
        cpuCores: 4,
        memoryGB: 8,
        storageGB: 50,
        latency: 30,
        costPerHour: 0.5,
        carbonIntensity: 100,
        tenantId,
      },
    });

    // Set Node B as anomaly
    await prisma.nodeHealthScore.upsert({
      where: { nodeId: nodeDegraded.id },
      update: {
        isAnomaly: true,
        successRate: 0.5,
        penaltyMultiplier: 0.1, // Strong penalty!
      },
      create: {
        nodeId: nodeDegraded.id,
        tenantId,
        isAnomaly: true,
        successRate: 0.5,
        penaltyMultiplier: 0.1,
      },
    });

    // Set Node A as healthy (explicit score)
    await prisma.nodeHealthScore.upsert({
      where: { nodeId: nodeHealthy.id },
      update: {
        isAnomaly: false,
        successRate: 1.0,
        penaltyMultiplier: 1.0,
      },
      create: {
        nodeId: nodeHealthy.id,
        tenantId,
        isAnomaly: false,
        successRate: 1.0,
        penaltyMultiplier: 1.0,
      },
    });

    // Create a task
    const task = await prisma.task.create({
      data: {
        name: "Test Scheduling Node Health",
        type: "COMPUTE",
        status: "PENDING",
        priority: "MEDIUM",
        target: "EDGE",
        policy: "ml-optimized",
        reason: "node-health-scheduling-test",
        tenantId,
      },
    });

    await scheduler.enqueue(task);
    await scheduler.processQueue();

    // Verify task is assigned to Healthy Node A despite Node B having better basic stats
    const scheduledTask = await prisma.task.findUnique({
      where: { id: task.id },
    });
    expect(scheduledTask?.status).toBe("SCHEDULED");
    expect(scheduledTask?.nodeId).toBe(nodeHealthy.id);
  });

  it("should auto-recover when healthy tasks return", async () => {
    const node = await prisma.edgeNode.create({
      data: {
        name: "Recovery Node",
        status: "ONLINE",
        location: "US",
        region: "us-east-1",
        ipAddress: "10.0.0.14",
        port: 8089,
        url: "http://10.0.0.14:8089",
        cpuCores: 4,
        memoryGB: 8,
        storageGB: 50,
        latency: 50,
        costPerHour: 1.0,
        carbonIntensity: 100,
        tenantId,
      },
    });

    // Case 1: Still in Anomaly State - logging success reduces the anomaly severity and increases multiplier
    await prisma.nodeHealthScore.upsert({
      where: { nodeId: node.id },
      update: {
        isAnomaly: true,
        successRate: 0.6,
        penaltyMultiplier: 0.5,
      },
      create: {
        nodeId: node.id,
        tenantId,
        isAnomaly: true,
        successRate: 0.6,
        penaltyMultiplier: 0.5,
      },
    });

    const healthScorer: NodeHealthScorer = (scheduler as any).nodeHealthScorer;
    await healthScorer.recordTaskOutcome(node.id, tenantId, "SUCCESS", 50);

    let scoreRecord = await prisma.nodeHealthScore.findUnique({
      where: { nodeId: node.id },
    });

    // Expected new successRate = 0.6 * (1 - 0.0198) + 1.0 * 0.0198 = 0.60792
    // New anomaly severity = (0.85 - 0.60792) / 0.85 = 0.2848
    // penaltyMultiplier = 1.0 - 0.2848 = 0.7152
    expect(scoreRecord?.penaltyMultiplier).toBeCloseTo(0.715, 3);

    // Case 2: Not in Anomaly State anymore - logging success decays penalty multiplier upwards by 5%
    await prisma.nodeHealthScore.update({
      where: { nodeId: node.id },
      data: {
        isAnomaly: false,
        successRate: 0.9,
        penaltyMultiplier: 0.5,
      },
    });

    await healthScorer.recordTaskOutcome(node.id, tenantId, "SUCCESS", 50);

    scoreRecord = await prisma.nodeHealthScore.findUnique({
      where: { nodeId: node.id },
    });

    // Auto-recover path: penaltyMultiplier = min(current + 0.05, 1.0) = 0.5 + 0.05 = 0.55
    expect(scoreRecord?.penaltyMultiplier).toBeCloseTo(0.55, 3);

    // Case 3: Transition from Anomaly to Normal - resolving anomaly
    await prisma.nodeHealthScore.update({
      where: { nodeId: node.id },
      data: {
        isAnomaly: true,
        successRate: 0.848, // 0.848 * 0.9802 + 0.0198 = 0.851 (crosses the 0.85 threshold)
        penaltyMultiplier: 0.95,
      },
    });

    // Clear broadcastEvents to isolate the resolution event
    broadcastEvents.length = 0;

    await healthScorer.recordTaskOutcome(node.id, tenantId, "SUCCESS", 50);

    scoreRecord = await prisma.nodeHealthScore.findUnique({
      where: { nodeId: node.id },
    });

    expect(scoreRecord?.isAnomaly).toBe(false);
    expect(scoreRecord?.successRate).toBeGreaterThanOrEqual(0.85);

    // Check WebSocket resolution broadcast
    const resolvedEvent = broadcastEvents.find(
      (e) => e.event === "node:anomaly-resolved" && e.payload.nodeId === node.id
    );
    expect(resolvedEvent).toBeDefined();
    expect(resolvedEvent.payload.successRate).toBeGreaterThanOrEqual(0.85);
  });
});
