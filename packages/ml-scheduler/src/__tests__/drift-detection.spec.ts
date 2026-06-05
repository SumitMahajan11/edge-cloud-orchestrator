import { DriftDetector, PredictionOutcome } from "../drift-detector";
import { IMetricsCollector } from "@edgecloud/shared-kernel";

describe("DriftDetector", () => {
  let detector: DriftDetector;
  let metrics: vi.Mocked<IMetricsCollector>;

  beforeEach(() => {
    metrics = {
      updateMLDrift: vi.fn(),
    } as any;
    detector = new DriftDetector(metrics);
  });

  const createOutcome = (
    predicted: number,
    actual: number,
  ): PredictionOutcome => ({
    taskId: "t-" + Math.random(),
    nodeId: "n-1",
    modelVersion: "v1.0.0",
    predictedScore: predicted,
    actualScore: actual,
    timestamp: new Date(),
  });

  it("should not detect drift when predictions are accurate", () => {
    // Feed 100 accurate samples
    for (let i = 0; i < 100; i++) {
      detector.recordOutcome(createOutcome(0.8, 0.82)); // Small error
    }

    expect(detector.getMAE()).toBeLessThan(0.1);
    expect(detector.isDrifting()).toBe(false);
  });

  it("should detect drift when distributions shift", () => {
    // Feed 50 normal samples
    for (let i = 0; i < 50; i++) {
      detector.recordOutcome(createOutcome(0.8, 0.8));
    }
    expect(detector.isDrifting()).toBe(false);

    // Feed 50 shifted samples (large error)
    // FATAL_THRESHOLD is 0.5
    for (let i = 0; i < 50; i++) {
      detector.recordOutcome(createOutcome(0.8, 0.2)); // Error = 0.6
    }

    // After 100 samples total, 50 have 0.6 error and 50 have 0 error.
    // MAE = (50*0.6 + 50*0)/100 = 0.3
    // Wait, FATAL_THRESHOLD is 0.5. WARN_THRESHOLD is 0.3.
    // Let's feed more shifted samples to cross 0.5.

    for (let i = 0; i < 50; i++) {
      detector.recordOutcome(createOutcome(0.9, 0.1)); // Error = 0.8
    }

    // Now window (size 100) has 50 with 0.6 and 50 with 0.8 error.
    // MAE = (0.6 + 0.8)/2 = 0.7

    expect(detector.getMAE()).toBeGreaterThan(0.5);
    expect(detector.isDrifting()).toBe(true);
  });

  it("should emit a drift alert event when drift is detected", () => {
    const onDrift = vi.fn();
    detector.onDrift(onDrift);

    // Trigger drift
    for (let i = 0; i < 100; i++) {
      detector.recordOutcome(createOutcome(0.9, 0.1)); // Error = 0.8
    }

    expect(onDrift).toHaveBeenCalled();
    expect(onDrift).toHaveBeenCalledWith(expect.any(Number));
  });

  it("should eventually return to false when distribution recovers", () => {
    // 1. Establish drift
    for (let i = 0; i < 100; i++) {
      detector.recordOutcome(createOutcome(0.9, 0.1));
    }
    expect(detector.isDrifting()).toBe(true);

    // 2. Feed accurate samples
    for (let i = 0; i < 100; i++) {
      detector.recordOutcome(createOutcome(0.5, 0.5));
    }

    expect(detector.getMAE()).toBeLessThan(0.1);
    expect(detector.isDrifting()).toBe(false);
  });
});
