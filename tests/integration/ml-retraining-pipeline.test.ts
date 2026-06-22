/**
 * ML Retraining and Rollout Pipeline Integration Tests
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import {
  createTestNode,
  createTestTask,
  setupTestApp,
  teardownTestApp,
  type TestContext,
  waitFor,
} from "./helpers";

// Set environment overrides before everything
process.env.MIN_OUTCOMES_FOR_RETRAIN = "1";
process.env.SHADOW_EVAL_LIMIT = "2";
process.env.MOCK_ML_TRAINING = "true";

describe("ML Retraining and Rollout Pipeline", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  it("should trigger background retraining on warning drift, enters shadow mode, and promote model if better", async () => {
    const scheduler = (ctx.app as any).taskScheduler;
    expect(scheduler).toBeDefined();

    // 1. Setup an active model
    const registry = scheduler.modelRegistry;
    const baseVersion = "1.0.0";
    const metaPath = path.join(registry.MODEL_DIR, `model_${baseVersion}.json`);
    const modelPath = path.join(registry.MODEL_DIR, `model_${baseVersion}.joblib`);
    fs.writeFileSync(metaPath, JSON.stringify({
      version: baseVersion,
      algorithm: "GradientBoostingRegressor",
      mae: 0.25,
      created_at: new Date().toISOString(),
      artifact_path: modelPath,
    }));
    fs.writeFileSync(modelPath, "mock base model");

    // Fix: Ensure incrementalUpdater uses the same mocked registry
    (scheduler.incrementalUpdater as any).registry = registry;

    await registry.promoteModel(baseVersion);
    await scheduler.mlScheduler.checkHotSwap();

    // Verify base model is active
    let activeModel = await registry.getActiveModel();
    expect(activeModel?.version).toBe(baseVersion);

    // Seed outcome logs so the incremental updater has data
    const node = await createTestNode(ctx);
    await (ctx.prisma as any).outcomeLog.create({
      data: {
        taskId: uuidv4(),
        nodeId: node.id,
        schedulingDecision: "{}",
        predictedLatency: 100.0,
        actualLatency: 105.0,
        predictedCpuUsage: 0.5,
        actualCpuUsage: 0.52,
        outcome: "SUCCESS",
        timestamp: new Date(),
      },
    });

    // 2. Trigger warning drift (MAE ~0.375)
    // To get MAE = 0.375, we need 3 late completions (actualScore=0.5, error=0.5) and 1 on-time (actualScore=1.0, error=0)
    for (let i = 0; i < 4; i++) {
      const task = await ctx.prisma.task.create({
        data: {
          id: uuidv4(),
          name: `Drift Retrain Task ${i}`,
          type: "CUSTOM",
          priority: "MEDIUM",
          target: "EDGE",
          reason: "Test",
          policy: "ml-optimized",
          tenantId: ctx.tenantId,
          status: "COMPLETED",
          metadata: {
            predictedScore: 1.0,
            modelVersion: baseVersion,
          },
        },
      });
      await scheduler.recordTaskOutcome(task.id, i === 0 ? 1000 : 6000, "COMPLETED");
    }

    // Wait for retraining to complete and place the model in shadow mode
    await waitFor(async () => {
      const shadowModel = await scheduler.redis.get("ml:shadow_model_version");
      return shadowModel !== null;
    }, { timeout: 15000, interval: 200 });

    const shadowVersion = await scheduler.redis.get("ml:shadow_model_version");
    expect(shadowVersion).toBe("1.0.1");

    // 3. Verify that new tasks schedule with both active and shadow predictions
    // Force hotswap to ensure scheduler has loaded the shadow model
    await scheduler.mlScheduler.checkHotSwap();

    const testTask = await ctx.prisma.task.create({
      data: {
        id: uuidv4(),
        name: "Test Task Step 3",
        type: "CUSTOM",
        priority: "MEDIUM",
        image: "ubuntu:latest",
        target: "EDGE",
        reason: "Test",
        policy: "ml-optimized",
        tenantId: ctx.tenantId,
        status: "PENDING",
      },
    });
    const scheduleResult = await scheduler.mlScheduler.schedule(testTask, [node]);
    expect(scheduleResult.explanation.shadowResult).toBeDefined();
    expect(scheduleResult.explanation.shadowResult.version).toBe(shadowVersion);

    // 4. Complete tasks under shadow mode to reach SHADOW_EVAL_LIMIT (2)
    for (let i = 0; i < 2; i++) {
      const shadowTask = await ctx.prisma.task.create({
        data: {
          id: uuidv4(),
          name: `Shadow Task ${i}`,
          type: "CUSTOM",
          priority: "MEDIUM",
          image: "ubuntu:latest",
          target: "EDGE",
          reason: "Test",
          policy: "ml-optimized",
          nodeId: node.id,
          tenantId: ctx.tenantId,
          status: "COMPLETED",
          metadata: {
            predictedScore: 0.9,
            modelVersion: baseVersion,
            shadowResult: {
              version: shadowVersion,
              score: 0.95,
            },
          },
        },
      });

      await scheduler.recordTaskOutcome(shadowTask.id, 1000, "COMPLETED");
    }

    // Verify shadow model gets promoted to active
    await waitFor(async () => {
      const active = await registry.getActiveModel();
      return active?.version === shadowVersion;
    }, { timeout: 5000, interval: 100 });

    const newActiveModel = await registry.getActiveModel();
    expect(newActiveModel?.version).toBe(shadowVersion);

    // Verify Redis shadow keys are cleared
    const shadowModelKey = await scheduler.redis.get("ml:shadow_model_version");
    expect(shadowModelKey).toBeNull();
  });

  it("should trigger background retraining on warning drift, and reject shadow model if worse than active", async () => {
    const scheduler = (ctx.app as any).taskScheduler;
    const registry = scheduler.modelRegistry;

    // Reset drift detector
    scheduler.driftDetector.reset();

    // Active model is currently 1.0.1
    let activeModel = await registry.getActiveModel();
    const currentActiveVersion = activeModel?.version || "1.0.1";

    // 1. Seed outcome log
    const node = await createTestNode(ctx);
    await (ctx.prisma as any).outcomeLog.create({
      data: {
        taskId: uuidv4(),
        nodeId: node.id,
        schedulingDecision: "{}",
        predictedLatency: 100.0,
        actualLatency: 105.0,
        predictedCpuUsage: 0.5,
        actualCpuUsage: 0.52,
        outcome: "SUCCESS",
        timestamp: new Date(),
      },
    });

    // 2. Trigger warning drift again (MAE ~0.375)
    for (let i = 0; i < 4; i++) {
      const task = await ctx.prisma.task.create({
        data: {
          id: uuidv4(),
          name: `Drift Retrain Task 2 ${i}`,
          type: "CUSTOM",
          priority: "MEDIUM",
          target: "EDGE",
          reason: "Test",
          policy: "ml-optimized",
          tenantId: ctx.tenantId,
          status: "COMPLETED",
          metadata: {
            predictedScore: 1.0,
            modelVersion: currentActiveVersion,
          },
        },
      });
      await scheduler.recordTaskOutcome(task.id, i === 0 ? 1000 : 6000, "COMPLETED");
    }

    // Wait for retraining to complete and place the model in shadow mode
    await waitFor(async () => {
      const shadowModel = await scheduler.redis.get("ml:shadow_model_version");
      return shadowModel !== null;
    }, { timeout: 15000, interval: 200 });

    const shadowVersion = await scheduler.redis.get("ml:shadow_model_version");
    expect(shadowVersion).toBe("1.0.2");

    // Force hotswap to ensure scheduler has loaded the shadow model
    await scheduler.mlScheduler.checkHotSwap();

    // 3. Complete tasks with worse shadow performance
    for (let i = 0; i < 2; i++) {
      const shadowTask = await ctx.prisma.task.create({
        data: {
          id: uuidv4(),
          name: `Shadow Task 2 ${i}`,
          type: "CUSTOM",
          priority: "MEDIUM",
          image: "ubuntu:latest",
          target: "EDGE",
          reason: "Test",
          policy: "ml-optimized",
          tenantId: ctx.tenantId,
          status: "COMPLETED",
          metadata: {
            predictedScore: 0.9,
            modelVersion: currentActiveVersion,
            shadowResult: {
              version: shadowVersion,
              score: 0.45,
            },
          },
        },
      });

      await scheduler.recordTaskOutcome(shadowTask.id, 1000, "COMPLETED");
    }

    // Verify shadow model gets rejected (active remains currentActiveVersion)
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const finalActiveModel = await registry.getActiveModel();
    expect(finalActiveModel?.version).toBe(currentActiveVersion);

    // Verify Redis shadow keys are cleared
    const shadowModelKey = await scheduler.redis.get("ml:shadow_model_version");
    expect(shadowModelKey).toBeNull();
  });

  it("should trigger automatic model rollback on critical drift", async () => {
    const scheduler = (ctx.app as any).taskScheduler;
    const registry = scheduler.modelRegistry;

    // Reset drift detector
    scheduler.driftDetector.reset();

    // Currently active model might be 1.0.1 or 1.0.0 depending on previous tests
    let activeModel = await registry.getActiveModel();
    const currentActiveVersion = activeModel?.version || "1.0.0";

    // Let's trigger critical drift (MAE >= 0.5)
    // We record multiple outcomes with high error (status=FAILED => actualScore=0)
    for (let i = 0; i < 5; i++) {
      const task = await ctx.prisma.task.create({
        data: {
          id: uuidv4(),
          name: `Critical Drift Task ${i}`,
          type: "CUSTOM",
          priority: "MEDIUM",
          target: "EDGE",
          reason: "Test",
          policy: "ml-optimized",
          tenantId: ctx.tenantId,
          status: "FAILED",
          metadata: {
            predictedScore: 1.0,
            modelVersion: currentActiveVersion,
          },
        },
      });

      await scheduler.recordTaskOutcome(task.id, 6000, "FAILED");
    }

    // Wait for the rollback to happen
    await waitFor(async () => {
      const active = await registry.getActiveModel();
      return active?.version === "1.0.0";
    }, { timeout: 10000, interval: 200 });

    const finalActive = await registry.getActiveModel();
    expect(finalActive?.version).toBe("1.0.0");
  });
});
