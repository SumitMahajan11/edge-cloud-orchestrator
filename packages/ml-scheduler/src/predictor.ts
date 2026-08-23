import { type EdgeNode, type Task, createLogger } from "@edgecloud/shared-kernel";
import path from "path";
import fs from "fs";

let tf: any = null;
if ((globalThis as any).tf) {
  tf = (globalThis as any).tf;
} else {
  try {
    tf = require("@tensorflow/tfjs-node");
  } catch (_e) {
    console.warn("TensorFlow native addon not available, using mock predictor");
  }
}

const logger = createLogger("ml-predictor");

export interface TrainingExample {
  cpu_usage_pct: number;
  ram_usage_pct: number;
  current_task_count: number;
  avg_latency_ms: number;
  historical_success_rate_7d: number;
  region_cost_rate: number;
  priority: number;
  estimated_duration_ms: number;
  requires_gpu: number;
  image_size_mb: number;
  hour_of_day: number;
  day_of_week: number;
  outcome_score: number;
}

export class SchedulingPredictor {
  private model: any | null = null;
  private isTrained: boolean = false;
  private currentVersion: string | null = null;
  private readonly featureSize = 12;
  private useMock: boolean;

  constructor() {
    this.useMock = tf === null;
  }

  setMetrics(metrics: any) {
    if (metrics && typeof metrics.setMLFallbackMode === "function") {
      metrics.setMLFallbackMode(this.useMock);
    }
  }

  async train(
    historicalData: TrainingExample[],
  ): Promise<{ version: string; mae: number }> {
    if (this.useMock) {
      logger.warn("Mock predictor: training simulated");
      return { version: "mock-" + Date.now(), mae: 0.1 };
    }

    if (historicalData.length < 50) {
      throw new Error("Insufficient training data. Need at least 50 examples.");
    }

    // Prepare training data
    const xs = tf.tensor2d(historicalData.map((d) => this.encodeFeatures(d)));
    const ys = tf.tensor2d(historicalData.map((d) => [d.outcome_score]));

    // Build model (Refined for regression)
    this.model = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [this.featureSize],
          units: 32,
          activation: "relu",
        }),
        tf.layers.dropout({ rate: 0.1 }),
        tf.layers.dense({ units: 16, activation: "relu" }),
        tf.layers.dense({ units: 1, activation: "sigmoid" }),
      ],
    });

    this.model.compile({
      optimizer: tf.train.adam(0.005),
      loss: "meanSquaredError",
    });

    // Train
    const history = await this.model.fit(xs, ys, {
      epochs: 30,
      batchSize: 16,
      validationSplit: 0.1,
    });

    const mae = history.history.loss[history.history.loss.length - 1];
    const version = new Date().toISOString().replace(/[:.-]/g, "");

    this.isTrained = true;
    this.currentVersion = version;

    // Cleanup
    xs.dispose();
    ys.dispose();

    return { version, mae };
  }

  async predictAsync(task: Task, node: EdgeNode): Promise<number> {
    if (this.useMock || !this.isTrained || !this.model) {
      return this.heuristicPrediction(task, node);
    }

    const features = this.encodeTaskAndNode(task, node);
    const input = tf.tensor2d([features]);

    try {
      const prediction = this.model.predict(input);
      const data = await prediction.data();
      const score = data[0];

      input.dispose();
      prediction.dispose();

      return score;
    } catch (error) {
      input.dispose();
      throw error;
    }
  }

  async loadModel(modelDir: string, version: string): Promise<void> {
    const meta_path = path.join(modelDir, `model_${version}.json`);
    let meta: any = { version: version, algorithm: "TF" };

    if (fs.existsSync(meta_path)) {
      meta = JSON.parse(fs.readFileSync(meta_path, "utf-8"));
    }

    // Version Validation Gate - MUST happen even in mock mode
    const minVersion = process.env.MIN_MODEL_VERSION;
    if (minVersion && !this.isVersionSatisfied(meta.version, minVersion)) {
      throw new Error(
        `Model version ${meta.version} is below minimum required version ${minVersion}. Load aborted.`,
      );
    }

    if (this.useMock) {
      this.isTrained = true;
      this.currentVersion = meta.version;
      logger.info(`Mock model version ${meta.version} active`);
      return;
    }

    const isTF = meta.algorithm === "TF" || meta.algorithm === "TensorFlow.js";
    if (!isTF) {
      logger.info(
        `${meta.algorithm} model version ${meta.version} detected. Using heuristic fallback.`,
      );
      this.currentVersion = meta.version;
      this.isTrained = false;
    } else {
      const modelPath = `file://${path.join(modelDir, version, "model.json")}`;
      this.model = await tf.loadLayersModel(modelPath);
      this.isTrained = true;
      this.currentVersion = meta.version;
      logger.info(`Model version ${meta.version} loaded and active`);
    }
  }

  async saveModel(modelDir: string): Promise<void> {
    if (this.useMock || !this.isTrained || !this.model) {
      return;
    }

    if (!fs.existsSync(modelDir)) {
      fs.mkdirSync(modelDir, { recursive: true });
    }

    const version =
      this.currentVersion || new Date().toISOString().replace(/[:.-]/g, "");
    const modelPath = path.join(modelDir, version);
    if (!fs.existsSync(modelPath)) {
      fs.mkdirSync(modelPath, { recursive: true });
    }

    // Save layers model
    await this.model.save(`file://${modelPath}`);

    // Save metadata JSON
    const metadata = {
      version,
      algorithm: "TF",
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(modelDir, `model_${version}.json`),
      JSON.stringify(metadata, null, 2),
    );
  }

  private isVersionSatisfied(current: string, min: string): boolean {
    const stripV = (s: string) => (s.startsWith("v") ? s.substring(1) : s);
    const c = stripV(current).split(".").map(Number);
    const m = stripV(min).split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if ((c[i] || 0) > (m[i] || 0)) return true;
      if ((c[i] || 0) < (m[i] || 0)) return false;
    }
    return true; // Exactly equal
  }

  private encodeFeatures(d: TrainingExample): number[] {
    return [
      d.cpu_usage_pct / 100,
      d.ram_usage_pct / 100,
      Math.min(1, d.current_task_count / 20),
      Math.min(1, d.avg_latency_ms / 1000),
      d.historical_success_rate_7d,
      Math.min(1, d.region_cost_rate / 2.0),
      d.priority / 3,
      Math.min(1, d.estimated_duration_ms / 30000),
      d.requires_gpu,
      Math.min(1, d.image_size_mb / 500),
      d.hour_of_day / 24,
      d.day_of_week / 7,
    ];
  }

  private encodeTaskAndNode(task: Task, node: EdgeNode): number[] {
    const priorityMap: Record<string, number> = {
      LOW: 0,
      MEDIUM: 1,
      HIGH: 2,
      CRITICAL: 3,
    };

    const now = new Date();

    return [
      node.cpuUsage / 100,
      node.memoryUsage / 100,
      node.tasksRunning / 20,
      Math.min(1, node.latency / 1000),
      0.95, // Default success rate
      node.costPerHour / 2.0,
      priorityMap[task.priority] || 1,
      ((task.metadata?.estimated_duration_ms as number) || 5000) / 30000,
      task.metadata?.requires_gpu ? 1 : 0,
      ((task.metadata?.image_size_mb as number) || 0) / 500,
      now.getHours() / 24,
      now.getDay() / 7,
    ];
  }

  private heuristicPrediction(_task: Task, node: EdgeNode): number {
    let score = 1.0;
    score *= 1 - (node.cpuUsage / 100) * 0.4;
    score *= 1 - (node.memoryUsage / 100) * 0.3;
    score *= 1 - Math.min(1, node.latency / 500) * 0.2;
    if (node.status !== "ONLINE") score *= 0.1;
    if (node.tasksRunning >= node.maxTasks) score *= 0.05;
    return score;
  }

  getVersion(): string | null {
    return this.currentVersion;
  }

  getTrainedStatus(): boolean {
    return this.isTrained;
  }

  /**
   * Calculate feature importance for a specific prediction using perturbation.
   * This is a local attribution method similar to LIME/SHAP.
   */
  async getFeatureImportance(
    task: Task,
    node: EdgeNode,
  ): Promise<
    { name: string; contribution: number; direction: "positive" | "negative" }[]
  > {
    if (this.useMock || !this.isTrained || !this.model) {
      return this.getHeuristicImportance(task, node);
    }

    const featureNames = [
      "cpu_usage_pct",
      "ram_usage_pct",
      "current_task_count",
      "avg_latency_ms",
      "historical_success_rate_7d",
      "region_cost_rate",
      "priority",
      "estimated_duration_ms",
      "requires_gpu",
      "image_size_mb",
      "hour_of_day",
      "day_of_week",
    ];

    const originalFeatures = this.encodeTaskAndNode(task, node);
    const baselineScore = await this.predictAsync(task, node);
    const importance: Array<{
      name: string;
      contribution: number;
      direction: "positive" | "negative";
    }> = [];

    for (let i = 0; i < originalFeatures.length; i++) {
      // Perturb the feature: move toward the other extreme of the 0-1 scale
      const perturbedFeatures = [...originalFeatures];
      const originalValue = originalFeatures[i];

      // Calculate a local delta
      const delta = 0.1;
      let perturbedValue = originalValue! + delta;
      if (perturbedValue > 1.0) {
        perturbedValue = originalValue! - delta;
      }

      perturbedFeatures[i] = perturbedValue;

      const input = tf.tensor2d([perturbedFeatures]);
      const prediction = this.model.predict(input);
      const data = await prediction.data();
      const newScore = data[0];

      input.dispose();
      prediction.dispose();

      const diff = newScore - baselineScore;
      // const normalizedDiff = diff / (perturbedValue - originalValue); // Gradient approximation

      importance.push({
        name: featureNames[i]!,
        contribution: Math.abs(diff),
        direction: diff > 0 ? "positive" : ("negative" as const),
      });
    }

    // Sort by absolute contribution and return top features
    return importance.sort((a, b) => b.contribution - a.contribution);
  }

  private getHeuristicImportance(
    _task: Task,
    node: EdgeNode,
  ): {
    name: string;
    contribution: number;
    direction: "positive" | "negative";
  }[] {
    // Heuristic fallback for importance
    const importance = [
      {
        name: "cpu_usage_pct",
        contribution: node.cpuUsage / 100,
        direction: "negative" as const,
      },
      {
        name: "ram_usage_pct",
        contribution: node.memoryUsage / 100,
        direction: "negative" as const,
      },
      {
        name: "avg_latency_ms",
        contribution: Math.min(1, node.latency / 500),
        direction: "negative" as const,
      },
    ];
    return importance.sort((a, b) => b.contribution - a.contribution);
  }
}
