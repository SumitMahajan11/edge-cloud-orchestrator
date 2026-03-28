import type { Task, TaskPriority, TaskType } from '../types'
import { taskQueue } from './task-queue'

interface BatchConfig {
  maxBatchSize: number
  maxWaitTime: number // ms
  minBatchSize: number
  enableBatching: boolean
}

interface BatchTask {
  id: string
  name: string
  type: TaskType
  priority: TaskPriority
  count: number
  interval: number // ms between tasks
  data?: Record<string, unknown>
}

interface BatchStats {
  totalBatches: number
  totalTasks: number
  avgBatchSize: number
  avgProcessingTime: number
  successRate: number
}

const DEFAULT_BATCH_CONFIG: BatchConfig = {
  maxBatchSize: 10,
  maxWaitTime: 5000, // 5 seconds
  minBatchSize: 2,
  enableBatching: true
}

class BatchProcessor {
  private config: BatchConfig
  private pendingBatch: Task[] = []
  private batchTimeout: ReturnType<typeof setTimeout> | null = null
  private stats = {
    totalBatches: 0,
    totalTasks: 0,
    processingTimes: [] as number[],
    successes: 0,
    failures: 0
  }

  constructor(config: Partial<BatchConfig> = {}) {
    this.config = { ...DEFAULT_BATCH_CONFIG, ...config }
  }

  addToBatch(task: Task): boolean {
    if (!this.config.enableBatching) {
      return false
    }

    this.pendingBatch.push(task)

    // Start timer if not already running
    if (!this.batchTimeout) {
      this.batchTimeout = setTimeout(() => {
        this.flushBatch()
      }, this.config.maxWaitTime)
    }

    // Flush if batch is full
    if (this.pendingBatch.length >= this.config.maxBatchSize) {
      this.flushBatch()
      return true
    }

    return true
  }

  flushBatch(): Task[] | null {
    if (this.pendingBatch.length < this.config.minBatchSize) {
      return null
    }

    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout)
      this.batchTimeout = null
    }

    const batch = [...this.pendingBatch]
    this.pendingBatch = []

    this.stats.totalBatches++
    this.stats.totalTasks += batch.length

    return batch
  }

  async processBatch(tasks: Task[], processor: (task: Task) => Promise<void>): Promise<void> {
    const startTime = Date.now()
    const results = await Promise.allSettled(
      tasks.map(task => processor(task))
    )

    const duration = Date.now() - startTime
    this.stats.processingTimes.push(duration)

    // Keep only last 100 processing times
    if (this.stats.processingTimes.length > 100) {
      this.stats.processingTimes.shift()
    }

    results.forEach(result => {
      if (result.status === 'fulfilled') {
        this.stats.successes++
      } else {
        this.stats.failures++
      }
    })
  }

  createBatchTask(config: BatchTask): Task[] {
    const tasks: Task[] = []
    
    for (let i = 0; i < config.count; i++) {
      tasks.push({
        id: `${config.id}-${i + 1}`,
        name: `${config.name} (${i + 1}/${config.count})`,
        type: config.type,
        status: 'pending',
        target: 'edge',
        priority: config.priority,
        submittedAt: new Date(Date.now() + i * config.interval),
        duration: 0,
        cost: 0,
        latencyMs: 0,
        reason: 'batch-task',
        retryCount: 0,
        maxRetries: 3,
        metadata: {
          ...config.data,
          batchId: config.id,
          batchIndex: i + 1,
          batchTotal: config.count
        }
      })
    }

    return tasks
  }

  submitBatch(tasks: Task[]): void {
    tasks.forEach((task, index) => {
      setTimeout(() => {
        if (this.config.enableBatching && task.priority !== 'critical') {
          this.addToBatch(task)
        } else {
          taskQueue.enqueue(task)
        }
      }, index * 100) // Stagger submissions by 100ms
    })
  }

  getStats(): BatchStats {
    const avgProcessingTime = this.stats.processingTimes.length > 0
      ? this.stats.processingTimes.reduce((a, b) => a + b, 0) / this.stats.processingTimes.length
      : 0

    const totalAttempts = this.stats.successes + this.stats.failures
    const successRate = totalAttempts > 0
      ? (this.stats.successes / totalAttempts) * 100
      : 100

    return {
      totalBatches: this.stats.totalBatches,
      totalTasks: this.stats.totalTasks,
      avgBatchSize: this.stats.totalBatches > 0
        ? this.stats.totalTasks / this.stats.totalBatches
        : 0,
      avgProcessingTime,
      successRate
    }
  }

  getPendingBatchSize(): number {
    return this.pendingBatch.length
  }

  updateConfig(config: Partial<BatchConfig>): void {
    this.config = { ...this.config, ...config }
  }

  clearBatch(): Task[] {
    const batch = [...this.pendingBatch]
    this.pendingBatch = []
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout)
      this.batchTimeout = null
    }
    return batch
  }

  resetStats(): void {
    this.stats = {
      totalBatches: 0,
      totalTasks: 0,
      processingTimes: [],
      successes: 0,
      failures: 0
    }
  }
}

// Singleton instance
export const batchProcessor = new BatchProcessor()

export { BatchProcessor }
export type { BatchConfig, BatchTask, BatchStats }
