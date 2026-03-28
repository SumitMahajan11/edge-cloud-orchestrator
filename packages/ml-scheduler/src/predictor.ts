// Mock TensorFlow for preview mode - replace with actual tfjs-node in production
try {
  var tf = require('@tensorflow/tfjs-node');
} catch (e) {
  console.warn('TensorFlow native addon not available, using mock predictor');
  var tf = null;
}
import { Task, EdgeNode } from '@edgecloud/shared-kernel';

export interface TrainingExample {
  taskType: number;
  priority: number;
  cpuRequirement: number;
  memoryRequirement: number;
  nodeCpuAvailable: number;
  nodeMemoryAvailable: number;
  nodeLatency: number;
  timeOfDay: number;
  dayOfWeek: number;
  success: boolean;
  duration: number;
}

export class SchedulingPredictor {
  private model: any | null = null;
  private isTrained: boolean = false;
  private readonly featureSize = 9;
  private useMock: boolean;

  constructor() {
    this.useMock = tf === null;
  }

  async train(historicalData: TrainingExample[]): Promise<void> {
    if (this.useMock) {
      console.log('Mock predictor: training skipped');
      this.isTrained = true;
      return;
    }
    
    if (historicalData.length < 100) {
      console.warn('Insufficient training data. Need at least 100 examples.');
      return;
    }

    // Prepare training data
    const xs = tf.tensor2d(historicalData.map((d) => this.encodeFeatures(d)));
    const ys = tf.tensor2d(
      historicalData.map((d) => [d.success ? 1 : 0, this.normalizeDuration(d.duration)])
    );

    // Build model
    this.model = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [this.featureSize],
          units: 64,
          activation: 'relu',
          kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
        }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({
          units: 32,
          activation: 'relu',
          kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
        }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({
          units: 16,
          activation: 'relu',
        }),
        tf.layers.dense({
          units: 2,
          activation: 'sigmoid',
        }),
      ],
    });

    this.model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'meanSquaredError',
      metrics: ['accuracy'],
    });

    // Train
    await this.model.fit(xs, ys, {
      epochs: 50,
      batchSize: 32,
      validationSplit: 0.2,
      callbacks: [
        tf.callbacks.earlyStopping({
          monitor: 'val_loss',
          patience: 5,
          restoreBestWeights: true,
        }),
      ],
    });

    this.isTrained = true;

    // Cleanup tensors
    xs.dispose();
    ys.dispose();
  }

  predictSuccess(task: Task, node: EdgeNode): number {
    if (this.useMock || !this.isTrained || !this.model) {
      // Return heuristic-based prediction if model not trained
      return this.heuristicPrediction(task, node);
    }

    const features = this.encodeTaskAndNode(task, node);
    const input = tf.tensor2d([features]);
    
    const prediction = this.model.predict(input) as any;
    const [successProb] = prediction.dataSync();
    
    input.dispose();
    prediction.dispose();
    
    return successProb;
  }

  predictDuration(task: Task, node: EdgeNode): number {
    if (this.useMock || !this.isTrained || !this.model) {
      return 0;
    }

    const features = this.encodeTaskAndNode(task, node);
    const input = tf.tensor2d([features]);
    
    const prediction = this.model.predict(input) as any;
    const [, duration] = prediction.dataSync();
    
    input.dispose();
    prediction.dispose();
    
    return this.denormalizeDuration(duration);
  }

  async saveModel(path: string): Promise<void> {
    if (this.useMock || !this.model) return;
    await this.model.save(`file://${path}`);
  }

  async loadModel(path: string): Promise<void> {
    if (this.useMock) {
      this.isTrained = true;
      return;
    }
    this.model = await tf.loadLayersModel(`file://${path}/model.json`);
    this.isTrained = true;
  }

  private encodeFeatures(example: TrainingExample): number[] {
    return [
      example.taskType / 7, // Normalize task type (0-7)
      example.priority / 3, // Normalize priority (0-3)
      example.cpuRequirement / 16, // Normalize CPU (assume max 16 cores)
      example.memoryRequirement / 64, // Normalize memory (assume max 64GB)
      example.nodeCpuAvailable / 100, // CPU available %
      example.nodeMemoryAvailable / 100, // Memory available %
      Math.min(1, example.nodeLatency / 500), // Normalize latency
      example.timeOfDay / 24, // Hour of day
      example.dayOfWeek / 7, // Day of week
    ];
  }

  private encodeTaskAndNode(task: Task, node: EdgeNode): number[] {
    const taskTypeMap: Record<string, number> = {
      IMAGE_CLASSIFICATION: 0,
      DATA_AGGREGATION: 1,
      MODEL_INFERENCE: 2,
      SENSOR_FUSION: 3,
      VIDEO_PROCESSING: 4,
      LOG_ANALYSIS: 5,
      ANOMALY_DETECTION: 6,
      CUSTOM: 7,
    };

    const priorityMap: Record<string, number> = {
      LOW: 0,
      MEDIUM: 1,
      HIGH: 2,
      CRITICAL: 3,
    };

    const now = new Date();

    return [
      (taskTypeMap[task.type] || 0) / 7,
      (priorityMap[task.priority] || 1) / 3,
      0.5, // Unknown CPU requirement - use default
      0.5, // Unknown memory requirement - use default
      (100 - node.cpuUsage) / 100,
      (100 - node.memoryUsage) / 100,
      Math.min(1, node.latency / 500),
      now.getHours() / 24,
      now.getDay() / 7,
    ];
  }

  private heuristicPrediction(task: Task, node: EdgeNode): number {
    // Simple heuristic when ML model is not available
    let score = 1.0;

    // Penalize high CPU usage
    score *= 1 - (node.cpuUsage / 100) * 0.3;

    // Penalize high memory usage
    score *= 1 - (node.memoryUsage / 100) * 0.3;

    // Penalize high latency
    score *= 1 - Math.min(1, node.latency / 500) * 0.2;

    // Boost for online status
    if (node.status !== 'ONLINE') {
      score *= 0.5;
    }

    // Penalize if node is at capacity
    if (node.tasksRunning >= node.maxTasks) {
      score *= 0.1;
    }

    return score;
  }

  private normalizeDuration(duration: number): number {
    // Normalize duration to 0-1 range (assume max 1 hour = 3600 seconds)
    return Math.min(1, duration / 3600);
  }

  private denormalizeDuration(normalized: number): number {
    return normalized * 3600;
  }
}
