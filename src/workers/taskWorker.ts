/**
 * Task Worker Service
 * Consumes tasks from the queue and dispatches them to edge agents
 */

import { logger } from '../lib/logger'
import type { Task, EdgeNode, TaskPriority } from '../types'

// Types
export interface WorkerConfig {
  id: string
  concurrency: number
  pollInterval: number
  heartbeatInterval: number
  taskTimeout: number
  retryDelay: number
}

export interface TaskExecution {
  taskId: string
  nodeId: string
  startTime: number
  status: 'running' | 'completed' | 'failed'
  error?: string
  result?: unknown
}

export interface WorkerStats {
  id: string
  status: 'idle' | 'running' | 'stopped'
  tasksProcessed: number
  tasksSucceeded: number
  tasksFailed: number
  avgExecutionTime: number
  currentLoad: number
  uptime: number
}

type WorkerEvent = 'task.started' | 'task.completed' | 'task.failed' | 'worker.started' | 'worker.stopped'
type WorkerCallback = (event: WorkerEvent, data: unknown) => void

const DEFAULT_CONFIG: WorkerConfig = {
  id: `worker-${Date.now()}`,
  concurrency: 5,
  pollInterval: 100,
  heartbeatInterval: 5000,
  taskTimeout: 30000,
  retryDelay: 1000,
}

/**
 * Task Worker - Consumes tasks and executes them on edge nodes
 */
export class TaskWorker {
  private config: WorkerConfig
  private status: 'idle' | 'running' | 'stopped' = 'stopped'
  private taskQueue: Array<{ task: Task; priority: TaskPriority }> = []
  private runningTasks: Map<string, TaskExecution> = new Map()
  private stats: WorkerStats
  private startTime = 0
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private callbacks: Map<WorkerEvent, Set<WorkerCallback>> = new Map()
  
  // Scheduler integration
  private nodeSelector: (task: Task) => EdgeNode | null
  private taskExecutor: (task: Task, node: EdgeNode) => Promise<unknown>

  constructor(
    config: Partial<WorkerConfig> = {},
    nodeSelector: (task: Task) => EdgeNode | null = () => null,
    taskExecutor: (task: Task, node: EdgeNode) => Promise<unknown> = async () => null
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.nodeSelector = nodeSelector
    this.taskExecutor = taskExecutor
    
    this.stats = {
      id: this.config.id,
      status: 'stopped',
      tasksProcessed: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      avgExecutionTime: 0,
      currentLoad: 0,
      uptime: 0,
    }
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    if (this.status === 'running') {
      logger.warn('Worker already running', { workerId: this.config.id })
      return
    }

    this.status = 'running'
    this.startTime = Date.now()
    this.stats.status = 'running'

    // Start polling for tasks
    this.pollTimer = setInterval(() => this.poll(), this.config.pollInterval)
    
    // Start heartbeat
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.config.heartbeatInterval)

    this.emit('worker.started', { workerId: this.config.id })
    logger.info('Task worker started', { workerId: this.config.id, concurrency: this.config.concurrency })
  }

  /**
   * Stop the worker gracefully
   */
  async stop(): Promise<void> {
    this.status = 'stopped'
    this.stats.status = 'stopped'

    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    // Wait for running tasks to complete
    const runningCount = this.runningTasks.size
    if (runningCount > 0) {
      logger.info('Waiting for running tasks to complete', { workerId: this.config.id, count: runningCount })
      
      // Give tasks 30 seconds to complete
      const timeout = 30000
      const startTime = Date.now()
      
      while (this.runningTasks.size > 0 && Date.now() - startTime < timeout) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    this.emit('worker.stopped', { workerId: this.config.id })
    logger.info('Task worker stopped', { workerId: this.config.id })
  }

  /**
   * Enqueue a task for execution
   */
  enqueue(task: Task, priority: TaskPriority = 'medium'): void {
    this.taskQueue.push({ task, priority })
    this.sortQueue()
    logger.debug('Task enqueued', { taskId: task.id, priority, queueSize: this.taskQueue.length })
  }

  /**
   * Poll for tasks and execute
   */
  private async poll(): Promise<void> {
    if (this.status !== 'running') return
    if (this.runningTasks.size >= this.config.concurrency) return
    if (this.taskQueue.length === 0) return

    const item = this.taskQueue.shift()
    if (!item) return

    await this.executeTask(item.task)
  }

  /**
   * Execute a task
   */
  private async executeTask(task: Task): Promise<void> {
    // Select node for task
    const node = this.nodeSelector(task)
    
    if (!node) {
      logger.warn('No suitable node found for task', { taskId: task.id })
      this.handleTaskFailure(task, 'No suitable node available')
      return
    }

    const execution: TaskExecution = {
      taskId: task.id,
      nodeId: node.id,
      startTime: Date.now(),
      status: 'running',
    }

    this.runningTasks.set(task.id, execution)
    this.stats.currentLoad = this.runningTasks.size / this.config.concurrency

    this.emit('task.started', { taskId: task.id, nodeId: node.id })
    logger.info('Task execution started', { taskId: task.id, nodeId: node.id })

    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(task, node)
      
      execution.status = 'completed'
      execution.result = result
      
      this.stats.tasksProcessed++
      this.stats.tasksSucceeded++
      this.updateAvgExecutionTime(Date.now() - execution.startTime)
      
      this.emit('task.completed', { taskId: task.id, nodeId: node.id, duration: Date.now() - execution.startTime })
      logger.info('Task completed', { taskId: task.id, nodeId: node.id, duration: Date.now() - execution.startTime })
    } catch (error) {
      execution.status = 'failed'
      execution.error = (error as Error).message
      
      this.stats.tasksProcessed++
      this.stats.tasksFailed++
      
      this.emit('task.failed', { taskId: task.id, nodeId: node.id, error: (error as Error).message })
      logger.error('Task failed', error as Error, { taskId: task.id, nodeId: node.id })
      
      // Handle retry
      if (task.retryCount < task.maxRetries) {
        this.scheduleRetry(task)
      }
    } finally {
      this.runningTasks.delete(task.id)
      this.stats.currentLoad = this.runningTasks.size / this.config.concurrency
    }
  }

  /**
   * Execute task with timeout
   */
  private async executeWithTimeout(task: Task, node: EdgeNode): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Task timeout after ${this.config.taskTimeout}ms`))
      }, this.config.taskTimeout)

      this.taskExecutor(task, node)
        .then(result => {
          clearTimeout(timeoutId)
          resolve(result)
        })
        .catch(error => {
          clearTimeout(timeoutId)
          reject(error)
        })
    })
  }

  /**
   * Handle task failure
   */
  private handleTaskFailure(task: Task, error: string): void {
    this.stats.tasksProcessed++
    this.stats.tasksFailed++
    
    this.emit('task.failed', { taskId: task.id, error })
    logger.error('Task failed', new Error(error), { taskId: task.id })

    if (task.retryCount < task.maxRetries) {
      this.scheduleRetry(task)
    }
  }

  /**
   * Schedule task retry
   */
  private scheduleRetry(task: Task): void {
    task.retryCount++
    const delay = this.config.retryDelay * Math.pow(2, task.retryCount - 1)
    
    setTimeout(() => {
      if (this.status === 'running') {
        this.enqueue(task, task.priority)
      }
    }, delay)
    
    logger.info('Task retry scheduled', { taskId: task.id, retryCount: task.retryCount, delay })
  }

  /**
   * Sort queue by priority
   */
  private sortQueue(): void {
    const priorityOrder: Record<TaskPriority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    }
    
    this.taskQueue.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
  }

  /**
   * Send heartbeat
   */
  private heartbeat(): void {
    this.stats.uptime = Date.now() - this.startTime
    logger.debug('Worker heartbeat', { 
      workerId: this.config.id, 
      status: this.status,
      queueSize: this.taskQueue.length,
      runningTasks: this.runningTasks.size,
      load: this.stats.currentLoad.toFixed(2)
    })
  }

  /**
   * Update average execution time
   */
  private updateAvgExecutionTime(duration: number): void {
    const count = this.stats.tasksSucceeded
    this.stats.avgExecutionTime = ((this.stats.avgExecutionTime * (count - 1)) + duration) / count
  }

  /**
   * Get worker statistics
   */
  getStats(): WorkerStats {
    return { ...this.stats }
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.taskQueue.length
  }

  /**
   * Get running task count
   */
  getRunningCount(): number {
    return this.runningTasks.size
  }

  /**
   * Subscribe to events
   */
  on(event: WorkerEvent, callback: WorkerCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: WorkerEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Worker callback error', error as Error)
      }
    })
  }
}

/**
 * Worker Pool - Manages multiple workers
 */
export class WorkerPool {
  private workers: Map<string, TaskWorker> = new Map()
  private _nodeSelector: (task: Task) => EdgeNode | null
  private _taskExecutor: (task: Task, node: EdgeNode) => Promise<unknown>

  constructor(
    nodeSelector: (task: Task) => EdgeNode | null,
    taskExecutor: (task: Task, node: EdgeNode) => Promise<unknown>
  ) {
    this._nodeSelector = nodeSelector
    this._taskExecutor = taskExecutor
  }

  /**
   * Add a worker to the pool
   */
  addWorker(config: Partial<WorkerConfig> = {}): string {
    const id = config.id || `worker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    const worker = new TaskWorker(
      { ...config, id },
      this._nodeSelector,
      this._taskExecutor
    )

    this.workers.set(id, worker)
    logger.info('Worker added to pool', { workerId: id })
    
    return id
  }

  /**
   * Remove a worker from the pool
   */
  async removeWorker(id: string): Promise<void> {
    const worker = this.workers.get(id)
    if (worker) {
      await worker.stop()
      this.workers.delete(id)
      logger.info('Worker removed from pool', { workerId: id })
    }
  }

  /**
   * Start all workers
   */
  async startAll(): Promise<void> {
    const promises = Array.from(this.workers.values()).map(w => w.start())
    await Promise.all(promises)
    logger.info('All workers started', { count: this.workers.size })
  }

  /**
   * Stop all workers
   */
  async stopAll(): Promise<void> {
    const promises = Array.from(this.workers.values()).map(w => w.stop())
    await Promise.all(promises)
    logger.info('All workers stopped', { count: this.workers.size })
  }

  /**
   * Dispatch task to least loaded worker
   */
  dispatch(task: Task, priority: TaskPriority = 'medium'): boolean {
    // Find worker with lowest load
    let targetWorker: TaskWorker | null = null
    let lowestLoad = Infinity

    for (const worker of this.workers.values()) {
      const stats = worker.getStats()
      if (stats.status === 'running' && stats.currentLoad < lowestLoad) {
        lowestLoad = stats.currentLoad
        targetWorker = worker
      }
    }

    if (targetWorker) {
      targetWorker.enqueue(task, priority)
      return true
    }

    logger.warn('No available worker for task', { taskId: task.id })
    return false
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    workers: number
    activeWorkers: number
    totalProcessed: number
    totalSucceeded: number
    totalFailed: number
    avgLoad: number
  } {
    let activeWorkers = 0
    let totalProcessed = 0
    let totalSucceeded = 0
    let totalFailed = 0
    let totalLoad = 0

    for (const worker of this.workers.values()) {
      const stats = worker.getStats()
      if (stats.status === 'running') {
        activeWorkers++
        totalLoad += stats.currentLoad
      }
      totalProcessed += stats.tasksProcessed
      totalSucceeded += stats.tasksSucceeded
      totalFailed += stats.tasksFailed
    }

    return {
      workers: this.workers.size,
      activeWorkers,
      totalProcessed,
      totalSucceeded,
      totalFailed,
      avgLoad: activeWorkers > 0 ? totalLoad / activeWorkers : 0,
    }
  }
}

// Default exports
export function createWorker(
  nodeSelector: (task: Task) => EdgeNode | null,
  taskExecutor: (task: Task, node: EdgeNode) => Promise<unknown>,
  config: Partial<WorkerConfig> = {}
): TaskWorker {
  return new TaskWorker(config, nodeSelector, taskExecutor)
}

export function createWorkerPool(
  nodeSelector: (task: Task) => EdgeNode | null,
  taskExecutor: (task: Task, node: EdgeNode) => Promise<unknown>
): WorkerPool {
  return new WorkerPool(nodeSelector, taskExecutor)
}
