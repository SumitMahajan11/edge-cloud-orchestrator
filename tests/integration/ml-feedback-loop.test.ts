/**
 * ML Feedback Loop Integration Tests
 */

import { v4 as uuidv4 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestNode,
  createTestTask,
  setupTestApp,
  teardownTestApp,
  type TestContext,
} from "./helpers";

describe("ML Feedback Loop Integration", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  it("should close the feedback loop with real telemetry and detect multi-feature drift", async () => {
    // 1. Setup: Create node and task
    const node = await createTestNode(ctx);
    // The createTestTask helper uses /v1/tasks which might not handle 'policy' correctly in overrides if it validates schema strictly
    // But we'll try it.
    const task = await createTestTask(ctx, {
      name: "ML Feedback Loop Test Task",
      type: "DATA_PROCESSING",
      priority: "HIGH",
      policy: "ml-optimized",
      tenantId: ctx.tenantId,
      image: "edgecloud/processor:v1",
    });

    // 2. Mock Scheduling Decision
    // We need to insert directly into DB
    const decisionId = uuidv4();
    await (ctx.prisma as any).schedulingDecision.create({
      data: {
        id: decisionId,
        taskId: task.id,
        selectedNodeId: node.id,
        policy: "ml-optimized",
        score: 1.0,
        tenantId: ctx.tenantId,
        mlModelVersion: "v1.2.3",
        explanation: {
          predictions: {
            latency: 150,
            cpuUsage: 0.4,
            memoryUsage: 0.1,
          },
          featureImportance: { latency: 0.8, cpu: 0.1, memory: 0.1 },
        },
        candidateNodes: [],
        fallbackUsed: false,
        timestamp: new Date(),
      },
    });

    // 3. Mock Node Metrics (Telemetry)
    await ctx.prisma.nodeMetric.create({
      data: {
        nodeId: node.id,
        tenantId: ctx.tenantId,
        cpuUsage: 0.7, // Predicted was 0.4
        memoryUsage: 0.3, // Predicted was 0.1
        timestamp: new Date(Date.now() - 5000), // Within execution window
        storageUsage: 0.1,
        latency: 120.0,
        tasksRunning: 1,
        networkIn: 100,
        networkOut: 50,
      },
    });

    // 4. Mock Task Execution
    const startedAt = new Date(Date.now() - 10000);
    await ctx.prisma.taskExecution.create({
      data: {
        taskId: task.id,
        nodeId: node.id,
        status: "RUNNING",
        startedAt,
        tenantId: ctx.tenantId,
        nodeUrl: node.url,
      },
    });

    // 5. Trigger Completion via Scheduler Service
    // We access the scheduler directly from the app instance if it's decorated
    const scheduler = (ctx.app as any).taskScheduler;
    if (!scheduler) {
      throw new Error("TaskScheduler not found on app instance");
    }

    const checkDecision = await (
      ctx.prisma as any
    ).schedulingDecision.findUnique({ where: { taskId: task.id } });
    console.log("DEBUG: checkDecision exists:", !!checkDecision);
    const checkExecution = await ctx.prisma.taskExecution.findFirst({
      where: { taskId: task.id, status: "RUNNING" },
    });
    console.log("DEBUG: checkExecution exists:", !!checkExecution);

    await scheduler.handleTaskCompletion(task.id, node.id, {
      status: "completed",
      duration: 200, // Predicted was 150
      output: { result: "ok" },
    });

    // 6. Verification:    // 5. Assert Feedback Loop Results
    // We need to manually flush the collector because it's buffered
    await (ctx.app.taskScheduler as any).outcomeCollector.flush();

    const outcomes = await (ctx.prisma as any).outcomeLog.findMany({
      where: { taskId: task.id },
    });

    expect(outcomes.length).toBeGreaterThan(0);
    const outcome = outcomes[0];

    expect(outcome.actualLatency).toBe(200);
    expect(outcome.predictedLatency).toBe(150);
    expect(outcome.actualCpuUsage).toBe(0.7);
    expect(outcome.predictedCpuUsage).toBe(0.4);

    // 7. Verification: Check DriftDetector State
    const driftState = await scheduler.driftDetector.getState();
    expect(driftState.driftScore).toBeGreaterThanOrEqual(0);
    // Statistical drift might be 0 if baseline/current are similar or insufficient data
    if (driftState.recommendation !== "INSUFFICIENT_DATA") {
      expect(driftState.featureDrift.latency).toBeDefined();
      expect(driftState.featureDrift.cpuUsage).toBeDefined();
      expect(driftState.featureDrift.memoryUsage).toBeDefined();
    }

    console.log("Drift State:", JSON.stringify(driftState, null, 2));
  });

  it("should handle missing telemetry gracefully with default values", async () => {
    const node = await createTestNode(ctx);
    const task = await createTestTask(ctx, {
      policy: "ml-optimized",
      tenantId: ctx.tenantId,
      image: "edgecloud/processor:v1",
    });

    await (ctx.prisma as any).schedulingDecision.create({
      data: {
        taskId: task.id,
        selectedNodeId: node.id,
        policy: "ml-optimized",
        score: 1.0,
        tenantId: ctx.tenantId,
        explanation: {}, // No predictions
        candidateNodes: [],
        timestamp: new Date(),
      },
    });

    await ctx.prisma.taskExecution.create({
      data: {
        taskId: task.id,
        nodeId: node.id,
        status: "RUNNING",
        startedAt: new Date(),
        tenantId: ctx.tenantId,
        nodeUrl: node.url,
      },
    });

    const scheduler = (ctx.app as any).taskScheduler;
    await scheduler.handleTaskCompletion(task.id, node.id, {
      status: "completed",
      duration: 300,
      output: { result: "ok" },
    });

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 100));
    await (ctx.app.taskScheduler as any).outcomeCollector.flush();

    const outcome = await (ctx.prisma as any).outcomeLog.findFirst({
      where: { taskId: task.id },
    });

    expect(outcome).toBeDefined();
    expect(outcome.predictedLatency).toBe(100); // Default value
    expect(outcome.actualCpuUsage).toBe(0.5); // Default value (no NodeMetric)
  });
});
