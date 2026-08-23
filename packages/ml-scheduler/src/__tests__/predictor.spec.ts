import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import fs from "fs";

// Define the mock tfjs-node module
const mockModelInstance = {
  compile: vi.fn(),
  fit: vi.fn(),
  predict: vi.fn(),
  save: vi.fn(),
};

const mockTensorInstance = {
  dispose: vi.fn(),
};

const mockTf = {
  tensor2d: vi.fn(),
  sequential: vi.fn(),
  train: {
    adam: vi.fn(),
  },
  loadLayersModel: vi.fn(),
  zeros: vi.fn(),
  layers: {
    dense: vi.fn(),
    dropout: vi.fn(),
  },
};

// Set global tf variable before importing the predictor
(globalThis as any).tf = mockTf;

let SchedulingPredictor: any;

describe("SchedulingPredictor", () => {
  let predictor: any;
  const mockTask: any = {
    id: "task-1",
    priority: "HIGH",
    metadata: {
      estimated_duration_ms: 10000,
      requires_gpu: true,
      image_size_mb: 200,
    },
  };

  const mockNode: any = {
    id: "node-1",
    url: "http://node-1",
    status: "ONLINE",
    cpuUsage: 30,
    memoryUsage: 40,
    tasksRunning: 2,
    maxTasks: 10,
    latency: 50,
    costPerHour: 1.0,
  };

  beforeAll(async () => {
    const mod = await import("../predictor");
    SchedulingPredictor = mod.SchedulingPredictor;
  });

  afterAll(() => {
    delete (globalThis as any).tf;
  });

  beforeEach(() => {
    predictor = new SchedulingPredictor();
    vi.clearAllMocks();

    // Re-register mock implementations so they survive restoreAllMocks()
    mockTf.tensor2d.mockReturnValue(mockTensorInstance);
    mockTf.sequential.mockReturnValue(mockModelInstance);
    mockTf.loadLayersModel.mockResolvedValue(mockModelInstance);
    mockTf.zeros.mockReturnValue(mockTensorInstance);

    mockModelInstance.compile.mockReturnValue(undefined);
    mockModelInstance.fit.mockResolvedValue({
      history: { loss: [0.05] },
    });
    mockModelInstance.predict.mockReturnValue({
      data: vi.fn().mockResolvedValue([0.85]),
      dispose: vi.fn(),
    });
    mockModelInstance.save.mockResolvedValue({});

    // Safely spy on fs methods to prevent Vitest loader issues
    const originalExistsSync = fs.existsSync;
    vi.spyOn(fs, "existsSync").mockImplementation((p: any) => {
      if (typeof p === "string" && p.includes("model_")) {
        return true;
      }
      if (typeof p === "string" && p.includes("dummy")) {
        return false;
      }
      return originalExistsSync(p);
    });

    const originalReadFileSync = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation((p: any, options?: any) => {
      if (typeof p === "string" && p.includes("model_")) {
        return JSON.stringify({ version: "1.0.0", algorithm: "TensorFlow.js" });
      }
      return originalReadFileSync(p, options);
    });

    const originalWriteFileSync = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation(
      (p: any, data: any, options?: any) => {
        if (
          typeof p === "string" &&
          (p.includes("model_") || p.includes("dummy"))
        ) {
          return;
        }
        return originalWriteFileSync(p, data, options);
      },
    );

    const originalMkdirSync = fs.mkdirSync;
    vi.spyOn(fs, "mkdirSync").mockImplementation((p: any, options?: any) => {
      if (typeof p === "string" && p.includes("dummy")) {
        return undefined as any;
      }
      return originalMkdirSync(p, options);
    });
  });

  afterEach(() => {
    delete process.env.MIN_MODEL_VERSION;
    vi.restoreAllMocks();
  });

  describe("Initialization & Metrics", () => {
    it("should set metrics fallback mode on initialization", () => {
      const mockMetrics = {
        setMLFallbackMode: vi.fn(),
      };
      predictor.setMetrics(mockMetrics);
      expect(mockMetrics.setMLFallbackMode).toHaveBeenCalledWith(false);
    });
  });

  describe("Training", () => {
    it("should train model when not in mock mode", async () => {
      const data = Array.from({ length: 60 }, (_, _i) => ({
        cpu_usage_pct: 10,
        ram_usage_pct: 20,
        current_task_count: 1,
        avg_latency_ms: 100,
        historical_success_rate_7d: 0.99,
        region_cost_rate: 0.5,
        priority: 1,
        estimated_duration_ms: 5000,
        requires_gpu: 0,
        image_size_mb: 100,
        hour_of_day: 12,
        day_of_week: 3,
        outcome_score: 0.95,
      }));

      const result = await predictor.train(data);
      expect(result.version).toBeDefined();
      expect(result.mae).toBe(0.05);
      expect(predictor.getTrainedStatus()).toBe(true);
      expect(predictor.getVersion()).toBe(result.version);
    });

    it("should fail training if data is insufficient", async () => {
      const data = Array.from({ length: 10 }, () => ({}) as any);
      let threw = false;
      try {
        await predictor.train(data);
      } catch (err: any) {
        threw = true;
        expect(err.message).toContain("Insufficient training data");
      }
      expect(threw).toBe(true);
    });

    it("should simulate training in mock mode", async () => {
      predictor.useMock = true;
      const result = await predictor.train([]);
      expect(result.version).toContain("mock-");
      expect(result.mae).toBe(0.1);
    });
  });

  describe("Prediction", () => {
    it("should return heuristic score in mock mode", async () => {
      predictor.useMock = true;
      const score = await predictor.predictAsync(mockTask, mockNode);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1.0);
    });

    it("should use neural network score when trained and not in mock mode", async () => {
      // Train model first
      const data = Array.from(
        { length: 60 },
        (_, _i) => ({ outcome_score: 0.9 }) as any,
      );
      await predictor.train(data);

      const score = await predictor.predictAsync(mockTask, mockNode);
      expect(score).toBe(0.85);
      expect(mockModelInstance.predict).toHaveBeenCalled();
    });

    it("should handle prediction exceptions and dispose of tensors", async () => {
      const data = Array.from(
        { length: 60 },
        (_, _i) => ({ outcome_score: 0.9 }) as any,
      );
      await predictor.train(data);

      vi.spyOn(mockModelInstance, "predict").mockImplementationOnce(() => {
        throw new Error("Inference failure");
      });

      let threw = false;
      try {
        await predictor.predictAsync(mockTask, mockNode);
      } catch (err: any) {
        threw = true;
        expect(err.message).toContain("Inference failure");
      }
      expect(threw).toBe(true);
      expect(mockTensorInstance.dispose).toHaveBeenCalled();
    });
  });

  describe("Model Loading & Saving", () => {
    it("should throw error if model version is below MIN_MODEL_VERSION", async () => {
      process.env.MIN_MODEL_VERSION = "2.0.0";

      vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
        return JSON.stringify({ version: "1.5.0", algorithm: "TensorFlow.js" });
      });

      let threw = false;
      try {
        await predictor.loadModel("/dummy/dir", "1.5.0");
      } catch (err: any) {
        threw = true;
        expect(err.message).toContain("is below minimum required version");
      }
      expect(threw).toBe(true);
    });

    it("should pass validation if version matches or exceeds MIN_MODEL_VERSION", async () => {
      process.env.MIN_MODEL_VERSION = "2.0.0";

      vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
        return JSON.stringify({ version: "2.0.0", algorithm: "TensorFlow.js" });
      });

      await predictor.loadModel("/dummy/dir", "2.0.0");
      expect(predictor.getVersion()).toBe("2.0.0");
    });

    it("should fallback to heuristics if algorithm is XGBoost", async () => {
      vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
        return JSON.stringify({ version: "2.0.0", algorithm: "XGBoost" });
      });

      await predictor.loadModel("/dummy/dir", "2.0.0");
      expect(predictor.getTrainedStatus()).toBe(false);
    });

    it("should load model and warm up in normal mode", async () => {
      vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
        return JSON.stringify({ version: "2.1.0", algorithm: "TensorFlow.js" });
      });

      await predictor.loadModel("/dummy/dir", "2.1.0");
      expect(predictor.getTrainedStatus()).toBe(true);
      expect(mockTf.loadLayersModel).toHaveBeenCalled();
    });

    it("should bypass layers model loading in mock mode", async () => {
      predictor.useMock = true;
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      await predictor.loadModel("/dummy/dir", "2.1.0");
      expect(predictor.getTrainedStatus()).toBe(true);
      expect(predictor.getVersion()).toBe("2.1.0");
    });

    it("should write metadata and save layers model in saveModel", async () => {
      const data = Array.from(
        { length: 60 },
        (_, _i) => ({ outcome_score: 0.9 }) as any,
      );
      await predictor.train(data);

      await predictor.saveModel("/dummy/dir");
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(mockModelInstance.save).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("should skip saving if in mock mode or not trained", async () => {
      await predictor.saveModel("/dummy/dir");
      expect(mockModelInstance.save).not.toHaveBeenCalled();

      predictor.useMock = true;
      await predictor.saveModel("/dummy/dir");
      expect(mockModelInstance.save).not.toHaveBeenCalled();
    });
  });

  describe("Feature Importance", () => {
    it("should return heuristic importance in mock mode", async () => {
      predictor.useMock = true;
      const importance = await predictor.getFeatureImportance(
        mockTask,
        mockNode,
      );
      expect(importance.length).toBe(3);
      // Sorted by contribution descending: ram_usage_pct (0.4) > cpu_usage_pct (0.3) > avg_latency_ms (0.1)
      expect(importance[0]!.name).toBe("ram_usage_pct");
    });

    it("should return perturbed feature importance in normal mode", async () => {
      const data = Array.from(
        { length: 60 },
        (_, _i) => ({ outcome_score: 0.9 }) as any,
      );
      await predictor.train(data);

      const importance = await predictor.getFeatureImportance(
        mockTask,
        mockNode,
      );
      expect(importance.length).toBe(12);
      expect(importance[0]!.contribution).toBeDefined();
    });
  });
});
