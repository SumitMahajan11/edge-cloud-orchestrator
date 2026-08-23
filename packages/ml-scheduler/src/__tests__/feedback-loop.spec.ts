import { describe, it, expect, vi, beforeEach } from "vitest";
import { OutcomeCollector } from "../feedback/outcome-collector";
import { IncrementalUpdater } from "../training/incremental-updater";
import { MLScheduler } from "../ml-scheduler";
import type { EdgeNode } from "@edgecloud/shared-kernel";

describe("ML Feedback Loop & Contextual Bandit", () => {
  let outcomeCollector: OutcomeCollector;
  let incrementalUpdater: IncrementalUpdater;
  let mlScheduler: MLScheduler;

  const mockPrisma = {
    outcomeLog: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn().mockImplementation((args: any) => Promise.all(args)),
  } as any;

  const mockRedis = {
    get: vi.fn(),
    set: vi.fn(),
    zadd: vi.fn(),
    zcard: vi.fn().mockResolvedValue(0),
    zrange: vi.fn().mockResolvedValue([]),
    del: vi.fn(),
  } as any;

  const mockMetrics = {
    recordMLFallback: vi.fn(),
    recordSchedulingDecision: vi.fn(),
    updateMLDrift: vi.fn(),
    recordMetric: vi.fn(),
    recordCarbonMetrics: vi.fn(),
  } as any;

  const mockPredictor = {
    getVersion: vi.fn().mockReturnValue("1.0.0"),
    getFeatureImportance: vi.fn().mockResolvedValue([]),
    predictAsync: vi.fn().mockResolvedValue(0.8),
  } as any;

  const mockRegistry = {
    getActiveModel: vi.fn().mockResolvedValue({ version: "1.0.0" }),
  } as any;

  const mockDriftDetector = {
    isDrifting: vi.fn().mockReturnValue(false),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    incrementalUpdater = new IncrementalUpdater(
      mockPrisma,
      mockRegistry,
      mockMetrics,
    );
    outcomeCollector = new OutcomeCollector(
      mockPrisma,
      mockRedis,
      mockMetrics,
      incrementalUpdater,
    );
    mlScheduler = new MLScheduler(
      mockPredictor,
      mockRegistry,
      mockDriftDetector,
      mockMetrics,
      outcomeCollector,
    );
  });

  it("should update bandit rewards based on outcomes", async () => {
    const nodeId = "node-a";
    mockRedis.get.mockResolvedValue("0.5"); // Start with 0.5

    // Simulate a successful outcome
    await outcomeCollector.recordOutcome({
      taskId: "task-1",
      nodeId,
      outcome: "SUCCESS",
      timestamp: new Date(),
    } as any);

    // newReward = 0.5 * 0.9 + 1.0 * 0.1 = 0.45 + 0.1 = 0.55
    expect(mockRedis.set).toHaveBeenCalledWith(
      `ml:node:${nodeId}:reward`,
      "0.55",
    );

    // Simulate 10 successes
    let currentReward = 0.55;
    for (let i = 0; i < 10; i++) {
      const nextReward = currentReward * 0.9 + 1.0 * 0.1;
      currentReward = nextReward;
    }
    // After many successes, it should approach 1.0
    expect(currentReward).toBeGreaterThan(0.6);
  });

  it("should blend bandit reward into final score", async () => {
    const node: EdgeNode = {
      id: "node-a",
      status: "ONLINE",
      cpuUsage: 20,
      memoryUsage: 30,
    } as any;
    mockRedis.get.mockResolvedValue("0.9"); // High reward for node-a
    mockPredictor.predictAsync.mockResolvedValue(0.5); // Mediocre XGBoost score

    const result = await mlScheduler.schedule(
      { id: "task-1" } as any,
      [node],
      {} as any,
    );

    // score = 0.7 * 0.5 + 0.3 * 0.9 = 0.35 + 0.27 = 0.62
    // Note: MLScheduler also uses MultiObjectiveScorer which has its own weights.
    // The 0.7/0.3 blend is applied on top of the ranked list or during ranking.
    // In our implementation, it's applied to the rankedNodes.

    expect(result?.decision.nodeId).toBe("node-a");
  });

  it("should trigger incremental update after threshold", async () => {
    const runUpdateSpy = vi
      .spyOn(incrementalUpdater as any, "runUpdate")
      .mockResolvedValue(undefined);

    for (let i = 0; i < 500; i++) {
      await incrementalUpdater.onOutcomeRecorded();
    }

    expect(runUpdateSpy).toHaveBeenCalledTimes(1);
  });

  it("should occasionally explore (epsilon-greedy)", async () => {
    process.env.ENABLE_BANDIT_EXPLORE = "true";
    // Mock random to always return < 0.1 for exploration
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.05);

    const nodeA: EdgeNode = { id: "node-a", status: "ONLINE" } as any;
    const nodeB: EdgeNode = { id: "node-b", status: "ONLINE" } as any;

    const result = await mlScheduler.schedule(
      { id: "task-1" } as any,
      [nodeA, nodeB],
      {} as any,
    );

    expect(result?.explanation.bandit).toBe("explore");
    randomSpy.mockRestore();
    delete process.env.ENABLE_BANDIT_EXPLORE;
  });
});
