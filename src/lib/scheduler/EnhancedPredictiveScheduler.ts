/**
 * Enhanced Predictive Scheduler with PostgreSQL Storage
 * ML-based scheduling with historical data persistence
 */

import { logger } from '../logger'
import type { Task, EdgeNode } from '../../types'

// Types
export interface TaskHistoryRecord {
  id: string
  taskType: string
  taskId: string
  nodeId: string
  executionTime: number
  success: boolean
  cpuAtExecution: number
  memoryAtExecution: number
  latencyAtExecution: number
  timestamp: Date
  metadata: Record<string, unknown>
}

export interface NodePerformanceRecord {
  nodeId: string
  taskType: string
  avgExecutionTime: number
  successRate: number
  sampleCount: number
  lastUpdated: Date
}

export interface PredictionModel {
  taskType: string
  avgExecutionTime: number
  stdDeviation: number
  nodePerformance: Map<string, number>
  featureWeights: FeatureWeights
  lastUpdated: Date
}

export interface FeatureWeights {
  latency: number
  cpuUsage: number
  memoryUsage: number
  failureProbability: number
  historicalPerformance: number
}

export interface SchedulerConfig {
  maxHistorySize: number
  modelUpdateInterval: number
  minSamplesForPrediction: number
  featureWeights: FeatureWeights
  persistenceEnabled: boolean
  databaseUrl?: string
}

export interface PredictionResult {
  node: EdgeNode
  score: number
  predictedLatency: number
  confidence: number
  factors: Record<string, number>
}

type SchedulerEvent = 'model.updated' | 'prediction.made' | 'history.recorded'
type SchedulerCallback = (event: SchedulerEvent, data: unknown) => void

const DEFAULT_CONFIG: SchedulerConfig = {
  maxHistorySize: 10000,
  modelUpdateInterval: 60000, // 1 minute
  minSamplesForPrediction: 5,
  featureWeights: {
    latency: 0.25,
    cpuUsage: 0.20,
    memoryUsage: 0.15,
    failureProbability: 0.20,
    historicalPerformance: 0.20,
  },
  persistenceEnabled: false,
}

/**
 * Enhanced Predictive Scheduler
 */
export class EnhancedPredictiveScheduler {
  private config: SchedulerConfig
  private history: TaskHistoryRecord[] = []
  private models: Map<string, PredictionModel> = new Map()
  private nodePerformance: Map<string, NodePerformanceRecord> = new Map()
  private lastModelUpdate = 0
  private callbacks: Map<SchedulerEvent, Set<SchedulerCallback>> = new Map()
  private dbClient: unknown = null

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    
    if (this.config.persistenceEnabled && this.config.databaseUrl) {
      this.initializeDatabase()
    }
  }

  /**
   * Initialize database connection
   */
  private async initializeDatabase(): Promise<void> {
    try {
      // @ts-expect-error - Optional dependency
      const { Pool } = await import('pg')
      
      this.dbClient = new Pool({
        connectionString: this.config.databaseUrl,
        max: 10,
        idleTimeoutMillis: 30000,
      })

      await this.createTables()
      await this.loadHistoricalData()
      
      logger.info('Predictive scheduler database initialized')
    } catch (error) {
      logger.error('Failed to initialize database for predictive scheduler', error as Error)
      this.config.persistenceEnabled = false
    }
  }

  /**
   * Create database tables
   */
  private async createTables(): Promise<void> {
    if (!this.dbClient) return

    const client = this.dbClient as { query: (sql: string) => Promise<void> }

    await client.query(`
      CREATE TABLE IF NOT EXISTS task_history (
        id SERIAL PRIMARY KEY,
        task_type VARCHAR(100) NOT NULL,
        task_id VARCHAR(100) NOT NULL,
        node_id VARCHAR(100) NOT NULL,
        execution_time INTEGER NOT NULL,
        success BOOLEAN NOT NULL,
        cpu_at_execution REAL,
        memory_at_execution REAL,
        latency_at_execution INTEGER,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metadata JSONB
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS node_performance (
        node_id VARCHAR(100) NOT NULL,
        task_type VARCHAR(100) NOT NULL,
        avg_execution_time REAL NOT NULL,
        success_rate REAL NOT NULL,
        sample_count INTEGER NOT NULL,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (node_id, task_type)
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_task_history_type ON task_history(task_type)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_task_history_node ON task_history(node_id)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_task_history_timestamp ON task_history(timestamp)
    `)
  }

  /**
   * Load historical data from database
   */
  private async loadHistoricalData(): Promise<void> {
    if (!this.dbClient) return

    const client = this.dbClient as { query: (sql: string) => Promise<{ rows: TaskHistoryRecord[] }> }

    const result = await client.query(`
      SELECT * FROM task_history 
      ORDER BY timestamp DESC 
      LIMIT $1
    `)

    this.history = result.rows
    logger.info('Loaded historical data', { count: this.history.length })

    // Load node performance
    const perfResult = await client.query(`
      SELECT * FROM node_performance
    `)

    for (const row of perfResult.rows) {
      this.nodePerformance.set(`${row.nodeId}:${row.taskType}`, {
        nodeId: row.nodeId,
        taskType: row.taskType,
        avgExecutionTime: (row as unknown as Record<string, unknown>).avgExecutionTime as number || 0,
        successRate: (row as unknown as Record<string, unknown>).successRate as number || 0,
        sampleCount: (row as unknown as Record<string, unknown>).sampleCount as number || 0,
        lastUpdated: new Date(),
      })
    }
  }

  /**
   * Record task execution
   */
  async recordExecution(record: Omit<TaskHistoryRecord, 'id' | 'timestamp'>): Promise<void> {
    const fullRecord: TaskHistoryRecord = {
      id: `hist-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      ...record,
    }

    this.history.push(fullRecord)

    // Trim history
    if (this.history.length > this.config.maxHistorySize) {
      this.history = this.history.slice(-this.config.maxHistorySize)
    }

    // Update node performance
    this.updateNodePerformance(record)

    // Persist to database
    if (this.config.persistenceEnabled && this.dbClient) {
      await this.persistRecord(fullRecord)
    }

    // Update model if needed
    if (Date.now() - this.lastModelUpdate > this.config.modelUpdateInterval) {
      this.updateModels()
    }

    this.emit('history.recorded', { record: fullRecord })
  }

  /**
   * Update node performance tracking
   */
  private updateNodePerformance(record: Omit<TaskHistoryRecord, 'id' | 'timestamp'>): void {
    const key = `${record.nodeId}:${record.taskType}`
    const existing = this.nodePerformance.get(key)

    if (existing) {
      // Update with exponential moving average
      const alpha = 0.2
      existing.avgExecutionTime = alpha * record.executionTime + (1 - alpha) * existing.avgExecutionTime
      existing.successRate = alpha * (record.success ? 1 : 0) + (1 - alpha) * existing.successRate
      existing.sampleCount++
      existing.lastUpdated = new Date()
    } else {
      this.nodePerformance.set(key, {
        nodeId: record.nodeId,
        taskType: record.taskType,
        avgExecutionTime: record.executionTime,
        successRate: record.success ? 1 : 0,
        sampleCount: 1,
        lastUpdated: new Date(),
      })
    }
  }

  /**
   * Persist record to database
   */
  private async persistRecord(record: TaskHistoryRecord): Promise<void> {
    if (!this.dbClient) return

    const client = this.dbClient as { query: (sql: string, params: unknown[]) => Promise<void> }

    try {
      await client.query(`
        INSERT INTO task_history 
        (task_type, task_id, node_id, execution_time, success, cpu_at_execution, 
         memory_at_execution, latency_at_execution, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        record.taskType,
        record.taskId,
        record.nodeId,
        record.executionTime,
        record.success,
        record.cpuAtExecution,
        record.memoryAtExecution,
        record.latencyAtExecution,
        JSON.stringify(record.metadata),
      ])
    } catch (error) {
      logger.error('Failed to persist task history', error as Error)
    }
  }

  /**
   * Update prediction models
   */
  private updateModels(): void {
    const taskTypes = new Set(this.history.map(h => h.taskType))

    for (const taskType of taskTypes) {
      const typeHistory = this.history.filter(h => h.taskType === taskType)

      if (typeHistory.length < this.config.minSamplesForPrediction) continue

      const executionTimes = typeHistory.map(h => h.executionTime)
      const avgExecutionTime = executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length

      // Calculate standard deviation
      const variance = executionTimes.reduce((sum, time) => {
        return sum + Math.pow(time - avgExecutionTime, 2)
      }, 0) / executionTimes.length
      const stdDeviation = Math.sqrt(variance)

      // Calculate node performance scores
      const nodePerformance = new Map<string, number>()
      const nodeIds = new Set(typeHistory.map(h => h.nodeId))

      for (const nodeId of nodeIds) {
        const nodeHistory = typeHistory.filter(h => h.nodeId === nodeId && h.success)
        if (nodeHistory.length === 0) continue

        const nodeAvg = nodeHistory.reduce((sum, h) => sum + h.executionTime, 0) / nodeHistory.length
        const successRate = nodeHistory.length / typeHistory.filter(h => h.nodeId === nodeId).length

        // Score: lower is better (faster execution, higher success rate)
        nodePerformance.set(nodeId, nodeAvg / successRate)
      }

      this.models.set(taskType, {
        taskType,
        avgExecutionTime,
        stdDeviation,
        nodePerformance,
        featureWeights: this.config.featureWeights,
        lastUpdated: new Date(),
      })
    }

    this.lastModelUpdate = Date.now()
    this.emit('model.updated', { taskTypes: Array.from(taskTypes) })
  }

  /**
   * Predict best node for task
   */
  predictBestNode(task: Task, nodes: EdgeNode[]): PredictionResult | null {
    if (nodes.length === 0) return null

    const model = this.models.get(task.type)
    const predictions: PredictionResult[] = []

    for (const node of nodes) {
      const prediction = this.calculateNodeScore(task, node, model)
      predictions.push(prediction)
    }

    // Sort by score (higher is better)
    predictions.sort((a, b) => b.score - a.score)

    const best = predictions[0]
    this.emit('prediction.made', { taskId: task.id, nodeId: best.node.id, score: best.score })

    return best
  }

  /**
   * Calculate node score
   */
  private calculateNodeScore(task: Task, node: EdgeNode, model?: PredictionModel): PredictionResult {
    const weights = model?.featureWeights || this.config.featureWeights
    const factors: Record<string, number> = {}

    // Latency factor (lower is better, normalized)
    const latencyScore = Math.max(0, 100 - (node.latency || 0)) / 100
    factors.latency = latencyScore

    // CPU usage factor (lower is better)
    const cpuScore = Math.max(0, 100 - node.cpu) / 100
    factors.cpuUsage = cpuScore

    // Memory usage factor (lower is better)
    const memoryScore = Math.max(0, 100 - node.memory) / 100
    factors.memoryUsage = memoryScore

    // Failure probability factor (based on historical data)
    const nodePerf = this.nodePerformance.get(`${node.id}:${task.type}`)
    const failureScore = nodePerf ? nodePerf.successRate : 0.5
    factors.failureProbability = failureScore

    // Historical performance factor
    let historicalScore = 0.5
    if (model && model.nodePerformance.has(node.id)) {
      const perf = model.nodePerformance.get(node.id)!
      historicalScore = 1 - (perf / model.avgExecutionTime)
      historicalScore = Math.max(0, Math.min(1, historicalScore))
    }
    factors.historicalPerformance = historicalScore

    // Calculate weighted score
    const score = 
      latencyScore * weights.latency +
      cpuScore * weights.cpuUsage +
      memoryScore * weights.memoryUsage +
      failureScore * weights.failureProbability +
      historicalScore * weights.historicalPerformance

    // Calculate predicted latency
    const predictedLatency = model?.nodePerformance.get(node.id) 
      || model?.avgExecutionTime 
      || (node.latency || 50) * 2

    // Calculate confidence
    const sampleCount = this.history.filter(
      h => h.taskType === task.type && h.nodeId === node.id
    ).length
    const confidence = Math.min(sampleCount / 20, 1)

    return {
      node,
      score,
      predictedLatency,
      confidence,
      factors,
    }
  }

  /**
   * Predict execution time
   */
  predictExecutionTime(task: Task, node: EdgeNode): { estimated: number; confidence: number } {
    const model = this.models.get(task.type)
    const nodePerf = this.nodePerformance.get(`${node.id}:${task.type}`)

    if (nodePerf) {
      const sampleCount = this.history.filter(
        h => h.taskType === task.type && h.nodeId === node.id
      ).length
      return {
        estimated: nodePerf.avgExecutionTime,
        confidence: Math.min(sampleCount / 10, 0.9),
      }
    }

    if (model) {
      return {
        estimated: model.avgExecutionTime * 1.2, // Add 20% buffer
        confidence: 0.5,
      }
    }

    // Fallback heuristic
    const baseTime = 1000
    const loadFactor = 1 + (node.cpu / 100)
    return {
      estimated: baseTime * loadFactor,
      confidence: 0.2,
    }
  }

  /**
   * Get model statistics
   */
  getModelStats(): Array<{
    taskType: string
    samples: number
    avgExecutionTime: number
    stdDeviation: number
    nodesTested: number
    lastUpdated: Date
  }> {
    return Array.from(this.models.values()).map(model => ({
      taskType: model.taskType,
      samples: this.history.filter(h => h.taskType === model.taskType).length,
      avgExecutionTime: model.avgExecutionTime,
      stdDeviation: model.stdDeviation,
      nodesTested: model.nodePerformance.size,
      lastUpdated: model.lastUpdated,
    }))
  }

  /**
   * Get recommendations
   */
  getRecommendations(nodes: EdgeNode[]): Array<{
    taskType: string
    recommendedNode: string
    reason: string
    confidence: number
  }> {
    const recommendations: Array<{
      taskType: string
      recommendedNode: string
      reason: string
      confidence: number
    }> = []

    for (const [taskType, model] of this.models) {
      let bestNodeId = ''
      let bestScore = Infinity

      for (const [nodeId, score] of model.nodePerformance) {
        if (score < bestScore) {
          bestScore = score
          bestNodeId = nodeId
        }
      }

      if (bestNodeId) {
        const node = nodes.find(n => n.id === bestNodeId)
        const sampleCount = this.history.filter(
          h => h.taskType === taskType && h.nodeId === bestNodeId
        ).length
        
        recommendations.push({
          taskType,
          recommendedNode: node?.name || bestNodeId,
          reason: `Best historical performance (${model.avgExecutionTime.toFixed(0)}ms avg)`,
          confidence: Math.min(sampleCount / 10, 1),
        })
      }
    }

    return recommendations
  }

  /**
   * Export data for analysis
   */
  exportData(): { history: TaskHistoryRecord[]; models: PredictionModel[] } {
    return {
      history: this.history,
      models: Array.from(this.models.values()),
    }
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.history = []
    this.models.clear()
    this.nodePerformance.clear()
    this.lastModelUpdate = 0
  }

  /**
   * Subscribe to events
   */
  on(event: SchedulerEvent, callback: SchedulerCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: SchedulerEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Scheduler callback error', error as Error)
      }
    })
  }
}

/**
 * Feature Store - Manages feature engineering for ML
 */
export class FeatureStore {
  private features: Map<string, Map<string, number[]>> = new Map()

  /**
   * Add feature value
   */
  addFeature(entityType: string, entityId: string, featureName: string, value: number): void {
    const entityKey = `${entityType}:${entityId}`
    
    if (!this.features.has(entityKey)) {
      this.features.set(entityKey, new Map())
    }
    
    const entityFeatures = this.features.get(entityKey)!
    const featureKey = featureName
    
    if (!entityFeatures.has(featureKey)) {
      entityFeatures.set(featureKey, [])
    }
    
    entityFeatures.get(featureKey)!.push(value)
    
    // Keep only last 100 values
    const values = entityFeatures.get(featureKey)!
    if (values.length > 100) {
      values.shift()
    }
  }

  /**
   * Get feature statistics
   */
  getFeatureStats(entityType: string, entityId: string, featureName: string): {
    mean: number
    std: number
    min: number
    max: number
    last: number
  } | null {
    const entityKey = `${entityType}:${entityId}`
    const entityFeatures = this.features.get(entityKey)
    
    if (!entityFeatures) return null
    
    const values = entityFeatures.get(featureName)
    if (!values || values.length === 0) return null

    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
    const std = Math.sqrt(variance)

    return {
      mean,
      std,
      min: Math.min(...values),
      max: Math.max(...values),
      last: values[values.length - 1],
    }
  }

  /**
   * Get all features for an entity
   */
  getEntityFeatures(entityType: string, entityId: string): Record<string, number[]> {
    const entityKey = `${entityType}:${entityId}`
    const entityFeatures = this.features.get(entityKey)
    
    if (!entityFeatures) return {}
    
    return Object.fromEntries(entityFeatures)
  }
}

// Factory functions
export function createEnhancedPredictiveScheduler(config: Partial<SchedulerConfig> = {}): EnhancedPredictiveScheduler {
  return new EnhancedPredictiveScheduler(config)
}

export function createFeatureStore(): FeatureStore {
  return new FeatureStore()
}

// Default instances
export const enhancedPredictiveScheduler = new EnhancedPredictiveScheduler()
export const featureStore = new FeatureStore()
