import type { Task, EdgeNode, SchedulingPolicy, TaskType, TaskPriority } from '../../types'
import { generateId } from '../utils'
import { predictiveScheduler } from '../predictive-scheduler'
import { taskQueue } from '../task-queue'
import { clusterManager } from '../clustering'
import { logger } from '../logger'

export interface SchedulerConfig {
  policy: SchedulingPolicy
  maxRetries: number
  taskTimeout: number
  batchSize: number
  pollInterval: number
}

export interface ScheduleResult {
  task: Task
  selectedNode: EdgeNode | null
  target: 'edge' | 'cloud'
  reason: string
  confidence: number
}

type SchedulerEvent = 'task.scheduled' | 'task.failed' | 'node.selected' | 'cloud.fallback'
type SchedulerCallback = (event: SchedulerEvent, data: unknown) => void

const DEFAULT_CONFIG: SchedulerConfig = {
  policy: 'latency-aware',
  maxRetries: 3,
  taskTimeout: 300000, // 5 minutes
  batchSize: 10,
  pollInterval: 100, // 100ms
}

/**
 * Backend Scheduler Service - Runs independently of frontend
 * Handles task scheduling, node selection, and queue management
 */
export class SchedulerService {
  private config: SchedulerConfig
  private isRunning = false
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private callbacks: Map<SchedulerEvent, Set<SchedulerCallback>> = new Map()
  private stats = {
    totalScheduled: 0,
    edgeTasks: 0,
    cloudTasks: 0,
    failedTasks: 0,
    avgLatency: 0,
    latencySum: 0,
  }

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Start the scheduler service
   */
  start(): void {
    if (this.isRunning) return
    this.isRunning = true
    logger.info('Scheduler service started', { policy: this.config.policy })
    this.startPolling()
  }

  /**
   * Stop the scheduler service
   */
  stop(): void {
    this.isRunning = false
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    logger.info('Scheduler service stopped')
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      this.processQueue()
    }, this.config.pollInterval)
  }

  private async processQueue(): Promise<void> {
    if (!this.isRunning) return

    // Process up to batchSize tasks
    for (let i = 0; i < this.config.batchSize; i++) {
      const task = taskQueue.dequeue()
      if (!task) break
      
      try {
        await this.scheduleTask(task)
      } catch (error) {
        logger.error('Failed to schedule task', error as Error, { taskId: task.id })
        this.emit('task.failed', { taskId: task.id, error })
      }
    }
  }

  /**
   * Submit a task to the scheduler
   */
  submitTask(
    name: string,
    type: TaskType,
    priority: TaskPriority,
    metadata?: Record<string, unknown>
  ): Task {
    const task: Task = {
      id: generateId(),
      name,
      type,
      status: 'pending',
      target: 'edge',
      priority,
      submittedAt: new Date(),
      duration: 0,
      cost: 0,
      latencyMs: 0,
      reason: 'Queued for scheduling',
      retryCount: 0,
      maxRetries: this.config.maxRetries,
      metadata,
    }

    taskQueue.enqueue(task)
    logger.info('Task submitted', { taskId: task.id, name, type, priority })
    
    return task
  }

  /**
   * Schedule a specific task
   */
  async scheduleTask(task: Task, nodes?: EdgeNode[]): Promise<ScheduleResult> {
    const availableNodes = nodes || clusterManager.getHealthyNodes().map(n => ({
      id: n.id,
      name: n.id,
      location: 'unknown',
      region: 'unknown',
      status: 'online' as const,
      cpu: 0,
      memory: 0,
      storage: 0,
      latency: 0,
      uptime: 99.9,
      tasksRunning: 0,
      maxTasks: 10,
      lastHeartbeat: new Date(),
      ip: '0.0.0.0',
      url: n.url,
      costPerHour: 0.01,
      bandwidthIn: 0,
      bandwidthOut: 0,
      healthHistory: [],
      isMaintenanceMode: false,
    }))

    const onlineNodes = availableNodes.filter(n => n.status !== 'offline' && !n.isMaintenanceMode)

    if (onlineNodes.length === 0) {
      return this.scheduleToCloud(task, 'No online nodes available')
    }

    // Try predictive scheduling first
    const predictedNode = predictiveScheduler.predictBestNode(task, onlineNodes)
    
    if (predictedNode) {
      const prediction = predictiveScheduler.predictExecutionTime(task, predictedNode)
      
      if (prediction.confidence > 0.6 && prediction.estimated < 5000) {
        const result = this.assignToNode(task, predictedNode, 
          `AI-predicted optimal node (${prediction.estimated.toFixed(0)}ms, ${(prediction.confidence * 100).toFixed(0)}% confidence)`)
        
        this.updateStats(result)
        return result
      }
    }

    // Fall back to policy-based scheduling
    const result = this.scheduleByPolicy(task, onlineNodes)
    this.updateStats(result)
    
    return result
  }

  private scheduleByPolicy(task: Task, nodes: EdgeNode[]): ScheduleResult {
    let selectedNode: EdgeNode | null = null
    let reason = ''

    switch (this.config.policy) {
      case 'latency-aware':
        selectedNode = this.selectByLatency(nodes)
        if (selectedNode && selectedNode.latency < 50 && selectedNode.cpu < 80) {
          reason = `Low latency (${selectedNode.latency.toFixed(1)}ms) and acceptable CPU (${selectedNode.cpu.toFixed(1)}%)`
        } else if (selectedNode) {
          // Route to cloud
          reason = `Edge latency too high (${selectedNode.latency.toFixed(1)}ms) - routed to cloud`
          selectedNode = null
        }
        break

      case 'cost-aware':
        selectedNode = this.selectByCost(nodes)
        if (selectedNode && selectedNode.cpu < 70) {
          reason = `Cost-optimized (${selectedNode.costPerHour.toFixed(4)}/hr) with acceptable load`
        } else if (selectedNode) {
          // Route to cloud
          reason = `Cheapest node overloaded - routed to cloud for cost efficiency`
          selectedNode = null
        }
        break

      case 'round-robin':
        selectedNode = this.selectRoundRobin(nodes)
        if (selectedNode && selectedNode.tasksRunning < selectedNode.maxTasks) {
          reason = `Round-robin selection - fewest tasks (${selectedNode.tasksRunning}/${selectedNode.maxTasks})`
        } else {
          // Route to cloud
          reason = 'All edge nodes at capacity - routed to cloud'
          selectedNode = null
        }
        break

      case 'load-balanced':
        selectedNode = this.selectByLoad(nodes)
        if (selectedNode) {
          const score = selectedNode.cpu * 0.4 + selectedNode.memory * 0.3 + selectedNode.latency * 0.3
          if (score < 60) {
            reason = `Load-balanced (score: ${score.toFixed(1)})`
          } else {
            // Route to cloud
            reason = `Edge load too high (score: ${score.toFixed(1)}) - routed to cloud`
            selectedNode = null
          }
        }
        break
    }

    if (selectedNode) {
      return this.assignToNode(task, selectedNode, reason)
    }

    return this.scheduleToCloud(task, reason)
  }

  private selectByLatency(nodes: EdgeNode[]): EdgeNode | null {
    return nodes.reduce((best, node) => 
      node.latency < (best?.latency ?? Infinity) ? node : best
    , null as EdgeNode | null)
  }

  private selectByCost(nodes: EdgeNode[]): EdgeNode | null {
    return nodes.reduce((cheapest, node) => 
      node.costPerHour < (cheapest?.costPerHour ?? Infinity) ? node : cheapest
    , null as EdgeNode | null)
  }

  private selectRoundRobin(nodes: EdgeNode[]): EdgeNode | null {
    const sorted = [...nodes].sort((a, b) => a.tasksRunning - b.tasksRunning)
    return sorted[0] || null
  }

  private selectByLoad(nodes: EdgeNode[]): EdgeNode | null {
    const scored = nodes.map(node => ({
      node,
      score: node.cpu * 0.4 + node.memory * 0.3 + (node.latency / 2) * 0.3,
    }))
    scored.sort((a, b) => a.score - b.score)
    return scored[0]?.node || null
  }

  private assignToNode(task: Task, node: EdgeNode, reason: string): ScheduleResult {
    task.nodeId = node.id
    task.target = 'edge'
    task.reason = reason
    task.status = 'scheduled'
    task.latencyMs = node.latency

    clusterManager.assignTask(node.id)
    
    this.emit('node.selected', { taskId: task.id, nodeId: node.id, reason })
    logger.info('Task assigned to node', { taskId: task.id, nodeId: node.id, reason })

    return {
      task,
      selectedNode: node,
      target: 'edge',
      reason,
      confidence: 0.8,
    }
  }

  private scheduleToCloud(task: Task, reason: string): ScheduleResult {
    task.target = 'cloud'
    task.nodeId = undefined
    task.reason = reason
    task.status = 'scheduled'
    task.latencyMs = 50 + Math.random() * 100

    this.emit('cloud.fallback', { taskId: task.id, reason })
    logger.info('Task routed to cloud', { taskId: task.id, reason })

    return {
      task,
      selectedNode: null,
      target: 'cloud',
      reason,
      confidence: 0.9,
    }
  }

  private updateStats(result: ScheduleResult): void {
    this.stats.totalScheduled++
    this.stats.latencySum += result.task.latencyMs
    this.stats.avgLatency = this.stats.latencySum / this.stats.totalScheduled

    if (result.target === 'edge') {
      this.stats.edgeTasks++
    } else {
      this.stats.cloudTasks++
    }
  }

  /**
   * Set scheduling policy
   */
  setPolicy(policy: SchedulingPolicy): void {
    this.config.policy = policy
    logger.info('Scheduling policy changed', { policy })
  }

  /**
   * Get scheduler statistics
   */
  getStats(): typeof this.stats & { policy: SchedulingPolicy; isRunning: boolean } {
    return {
      ...this.stats,
      policy: this.config.policy,
      isRunning: this.isRunning,
    }
  }

  /**
   * Subscribe to scheduler events
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

// Singleton instance - runs independently of frontend
export const schedulerService = new SchedulerService()
