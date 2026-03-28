/**
 * ML Model Training for Predictive Scheduler
 * Replaces heuristics with actual trained models
 */

import { logger } from '../logger'
import type { Task, EdgeNode } from '../../types'

// Types
export interface TrainingSample {
  features: number[]
  label: number // Execution time
  taskType: string
  nodeId: string
  timestamp: number
}

export interface ModelWeights {
  bias: number
  weights: number[]
}

export interface TrainedModel {
  taskType: string
  weights: ModelWeights
  featureMeans: number[]
  featureStds: number[]
  trainingSamples: number
  lastUpdated: number
  mse: number
  r2Score: number
}

export interface TrainingConfig {
  learningRate: number
  epochs: number
  batchSize: number
  regularization: number
  minSamples: number
  featureCount: number
}

export interface PredictionResult {
  estimatedTime: number
  confidence: number
  features: Record<string, number>
  modelVersion: string
}

type ModelEvent = 'model.trained' | 'model.updated' | 'prediction.made'
type ModelCallback = (event: ModelEvent, data: unknown) => void

const DEFAULT_CONFIG: TrainingConfig = {
  learningRate: 0.01,
  epochs: 100,
  batchSize: 32,
  regularization: 0.001,
  minSamples: 50,
  featureCount: 10,
}

// Feature names for interpretability
const FEATURE_NAMES = [
  'cpu_usage',
  'memory_usage',
  'network_latency',
  'disk_io',
  'task_complexity',
  'historical_avg',
  'time_of_day',
  'day_of_week',
  'concurrent_tasks',
  'node_load',
]

/**
 * Linear Regression Model with Gradient Descent
 */
class LinearRegressionModel {
  private weights: ModelWeights
  private featureMeans: number[] = []
  private featureStds: number[] = []
  private trained = false

  constructor(featureCount: number) {
    this.weights = {
      bias: 0,
      weights: new Array(featureCount).fill(0),
    }
  }

  /**
   * Normalize features
   */
  private normalize(features: number[]): number[] {
    return features.map((f, i) => {
      if (this.featureStds[i] === 0) return 0
      return (f - this.featureMeans[i]) / this.featureStds[i]
    })
  }

  /**
   * Fit the model using gradient descent
   */
  fit(samples: TrainingSample[], config: TrainingConfig): { mse: number; r2Score: number } {
    if (samples.length < config.minSamples) {
      throw new Error(`Need at least ${config.minSamples} samples, got ${samples.length}`)
    }

    // Extract features and labels
    const X = samples.map(s => s.features)
    const y = samples.map(s => s.label)

    // Calculate feature statistics for normalization
    this.featureMeans = new Array(config.featureCount).fill(0)
    this.featureStds = new Array(config.featureCount).fill(0)

    for (let j = 0; j < config.featureCount; j++) {
      const values = X.map(x => x[j])
      this.featureMeans[j] = values.reduce((a, b) => a + b, 0) / values.length
      const variance = values.reduce((sum, v) => sum + Math.pow(v - this.featureMeans[j], 2), 0) / values.length
      this.featureStds[j] = Math.sqrt(variance) || 1
    }

    // Normalize features
    const XNormalized = X.map(f => this.normalize(f))

    // Gradient descent
    const n = samples.length
    
    for (let epoch = 0; epoch < config.epochs; epoch++) {
      // Shuffle data
      const indices = Array.from({ length: n }, (_, i) => i)
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[indices[i], indices[j]] = [indices[j], indices[i]]
      }

      // Mini-batch gradient descent
      for (let batch = 0; batch < n; batch += config.batchSize) {
        const batchIndices = indices.slice(batch, batch + config.batchSize)
        
        let gradientBias = 0
        const gradientWeights = new Array(config.featureCount).fill(0)

        for (const i of batchIndices) {
          const prediction = this.predictSingle(XNormalized[i])
          const error = prediction - y[i]

          gradientBias += error
          for (let j = 0; j < config.featureCount; j++) {
            gradientWeights[j] += error * XNormalized[i][j]
          }
        }

        // Update weights with L2 regularization
        const batchSize = batchIndices.length
        this.weights.bias -= config.learningRate * (gradientBias / batchSize)
        for (let j = 0; j < config.featureCount; j++) {
          this.weights.weights[j] -= config.learningRate * (
            gradientWeights[j] / batchSize + 
            config.regularization * this.weights.weights[j]
          )
        }
      }
    }

    this.trained = true

    // Calculate metrics
    const predictions = XNormalized.map(f => this.predictSingle(f))
    const mse = predictions.reduce((sum, p, i) => sum + Math.pow(p - y[i], 2), 0) / n
    
    const yMean = y.reduce((a, b) => a + b, 0) / n
    const ssRes = predictions.reduce((sum, p, i) => sum + Math.pow(y[i] - p, 2), 0)
    const ssTot = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0)
    const r2Score = 1 - (ssRes / ssTot)

    return { mse, r2Score }
  }

  /**
   * Predict for a single sample
   */
  private predictSingle(features: number[]): number {
    let prediction = this.weights.bias
    for (let i = 0; i < features.length; i++) {
      prediction += this.weights.weights[i] * features[i]
    }
    return prediction
  }

  /**
   * Predict execution time
   */
  predict(features: number[]): number {
    if (!this.trained) return 1000 // Default 1 second
    const normalized = this.normalize(features)
    return Math.max(0, this.predictSingle(normalized))
  }

  /**
   * Get model weights
   */
  getWeights(): ModelWeights {
    return { ...this.weights }
  }

  /**
   * Set model weights
   */
  setWeights(weights: ModelWeights): void {
    this.weights = { ...weights }
    this.trained = true
  }

  /**
   * Set normalization parameters
   */
  setNormalization(means: number[], stds: number[]): void {
    this.featureMeans = means
    this.featureStds = stds
  }
}

/**
 * ML Model Manager
 */
export class MLModelManager {
  private config: TrainingConfig
  private models: Map<string, LinearRegressionModel> = new Map()
  private trainingData: Map<string, TrainingSample[]> = new Map()
  private modelVersions: Map<string, TrainedModel> = new Map()
  private callbacks: Map<ModelEvent, Set<ModelCallback>> = new Map()
  private maxSamplesPerType = 10000

  constructor(config: Partial<TrainingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Extract features from task and node
   */
  extractFeatures(task: Task, node: EdgeNode, historicalAvg?: number): number[] {
    const now = new Date()
    
    return [
      node.cpu / 100,                              // cpu_usage (normalized 0-1)
      node.memory / 100,                           // memory_usage (normalized 0-1)
      (node.latency || 50) / 100,                  // network_latency (normalized)
      (node.storage || 50) / 100,                  // disk_io (proxy)
      this.getTaskComplexity(task),                // task_complexity
      (historicalAvg || 1000) / 10000,            // historical_avg (normalized)
      now.getHours() / 24,                         // time_of_day
      now.getDay() / 7,                            // day_of_week
      node.tasksRunning / Math.max(node.maxTasks, 1), // concurrent_tasks
      (node.cpu + node.memory) / 200,             // node_load
    ]
  }

  /**
   * Get task complexity score
   */
  private getTaskComplexity(task: Task): number {
    const complexityMap: Record<string, number> = {
      'Image Classification': 0.7,
      'Data Aggregation': 0.3,
      'Model Inference': 0.9,
      'Sensor Fusion': 0.8,
      'Video Processing': 0.95,
      'Log Analysis': 0.4,
      'Anomaly Detection': 0.6,
    }
    return complexityMap[task.type] || 0.5
  }

  /**
   * Add training sample
   */
  addSample(
    task: Task,
    node: EdgeNode,
    executionTime: number,
    historicalAvg?: number
  ): void {
    const features = this.extractFeatures(task, node, historicalAvg)
    
    const sample: TrainingSample = {
      features,
      label: executionTime,
      taskType: task.type,
      nodeId: node.id,
      timestamp: Date.now(),
    }

    if (!this.trainingData.has(task.type)) {
      this.trainingData.set(task.type, [])
    }

    const samples = this.trainingData.get(task.type)!
    samples.push(sample)

    // Trim to max samples
    if (samples.length > this.maxSamplesPerType) {
      this.trainingData.set(task.type, samples.slice(-this.maxSamplesPerType))
    }
  }

  /**
   * Train model for a task type
   */
  train(taskType: string): TrainedModel | null {
    const samples = this.trainingData.get(taskType)
    
    if (!samples || samples.length < this.config.minSamples) {
      logger.warn('Not enough samples for training', { taskType, samples: samples?.length || 0 })
      return null
    }

    // Create or get model
    let model = this.models.get(taskType)
    if (!model) {
      model = new LinearRegressionModel(this.config.featureCount)
    }

    try {
      const { mse, r2Score } = model.fit(samples, this.config)
      
      const trainedModel: TrainedModel = {
        taskType,
        weights: model.getWeights(),
        featureMeans: model['featureMeans'],
        featureStds: model['featureStds'],
        trainingSamples: samples.length,
        lastUpdated: Date.now(),
        mse,
        r2Score,
      }

      this.models.set(taskType, model)
      this.modelVersions.set(taskType, trainedModel)

      this.emit('model.trained', { taskType, mse, r2Score, samples: samples.length })
      logger.info('Model trained', { taskType, mse, r2Score, samples: samples.length })

      return trainedModel
    } catch (error) {
      logger.error('Model training failed', error as Error, { taskType })
      return null
    }
  }

  /**
   * Predict execution time
   */
  predict(task: Task, node: EdgeNode, historicalAvg?: number): PredictionResult {
    const model = this.models.get(task.type)
    const features = this.extractFeatures(task, node, historicalAvg)
    
    let estimatedTime = 1000 // Default 1 second
    let confidence = 0.3

    if (model) {
      estimatedTime = model.predict(features)
      
      const modelInfo = this.modelVersions.get(task.type)
      if (modelInfo) {
        confidence = Math.min(0.9, 0.3 + (modelInfo.r2Score * 0.5) + (modelInfo.trainingSamples / 1000) * 0.1)
      }
    }

    const featureMap: Record<string, number> = {}
    FEATURE_NAMES.forEach((name, i) => {
      featureMap[name] = features[i]
    })

    const result: PredictionResult = {
      estimatedTime,
      confidence,
      features: featureMap,
      modelVersion: `${task.type}-v${Date.now()}`,
    }

    this.emit('prediction.made', { taskId: task.id, nodeId: node.id, estimatedTime, confidence })
    
    return result
  }

  /**
   * Get best node based on ML prediction
   */
  predictBestNode(
    task: Task,
    nodes: EdgeNode[],
    historicalAvgs: Map<string, number> = new Map()
  ): { node: EdgeNode; estimatedTime: number; confidence: number } | null {
    if (nodes.length === 0) return null

    let bestNode: EdgeNode | null = null
    let bestTime = Infinity
    let bestConfidence = 0

    for (const node of nodes) {
      if (node.status !== 'online') continue
      
      const historicalAvg = historicalAvgs.get(node.id)
      const prediction = this.predict(task, node, historicalAvg)

      if (prediction.estimatedTime < bestTime) {
        bestTime = prediction.estimatedTime
        bestNode = node
        bestConfidence = prediction.confidence
      }
    }

    return bestNode ? { node: bestNode, estimatedTime: bestTime, confidence: bestConfidence } : null
  }

  /**
   * Get model info
   */
  getModelInfo(taskType: string): TrainedModel | undefined {
    return this.modelVersions.get(taskType)
  }

  /**
   * Get all model info
   */
  getAllModels(): TrainedModel[] {
    return Array.from(this.modelVersions.values())
  }

  /**
   * Get training data stats
   */
  getTrainingStats(): Record<string, { samples: number; hasModel: boolean }> {
    const stats: Record<string, { samples: number; hasModel: boolean }> = {}
    
    for (const [taskType, samples] of this.trainingData) {
      stats[taskType] = {
        samples: samples.length,
        hasModel: this.models.has(taskType),
      }
    }

    return stats
  }

  /**
   * Export model for persistence
   */
  exportModel(taskType: string): TrainedModel | null {
    return this.modelVersions.get(taskType) || null
  }

  /**
   * Import model from persistence
   */
  importModel(model: TrainedModel): void {
    const lrModel = new LinearRegressionModel(this.config.featureCount)
    lrModel.setWeights(model.weights)
    lrModel.setNormalization(model.featureMeans, model.featureStds)
    
    this.models.set(model.taskType, lrModel)
    this.modelVersions.set(model.taskType, model)
    
    logger.info('Model imported', { taskType: model.taskType, samples: model.trainingSamples })
  }

  /**
   * Subscribe to events
   */
  on(event: ModelEvent, callback: ModelCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: ModelEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('ML model callback error', error as Error)
      }
    })
  }
}

/**
 * Create ML model manager
 */
export function createMLModelManager(config: Partial<TrainingConfig> = {}): MLModelManager {
  return new MLModelManager(config)
}

// Default instance
export const mlModelManager = new MLModelManager()
