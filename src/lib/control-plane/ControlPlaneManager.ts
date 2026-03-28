/**
 * Control Plane - Separated from Execution Layer
 * Handles scheduling decisions, policy management, and cluster coordination
 * WITHOUT directly executing tasks
 */

import { logger } from '../logger'
import type { Task, EdgeNode, TaskPriority, SchedulingPolicy } from '../../types'

// Types
export interface ControlPlaneConfig {
  nodeId: string
  region: string
  schedulerShards: number
  decisionTimeout: number
  maxPendingDecisions: number
}

export interface SchedulingDecision {
  id: string
  taskId: string
  nodeId: string
  policy: SchedulingPolicy
  priority: TaskPriority
  reason: string
  constraints: SchedulingConstraints
  createdAt: number
  expiresAt: number
  status: 'pending' | 'dispatched' | 'acknowledged' | 'expired'
}

export interface SchedulingConstraints {
  minCpu?: number
  minMemory?: number
  minStorage?: number
  maxLatency?: number
  requiredCapabilities?: string[]
  regionPreference?: string[]
  antiAffinity?: string[] // Node IDs to avoid
}

export interface ExecutionCommand {
  decisionId: string
  taskId: string
  nodeId: string
  action: 'execute' | 'cancel' | 'migrate' | 'checkpoint'
  payload: unknown
  createdAt: number
}

export interface ExecutionAck {
  decisionId: string
  nodeId: string
  status: 'accepted' | 'rejected' | 'failed'
  reason?: string
  timestamp: number
}

type ControlPlaneEvent = 'decision.created' | 'decision.dispatched' | 'decision.acknowledged' | 'decision.expired'
type ControlPlaneCallback = (event: ControlPlaneEvent, data: unknown) => void

const DEFAULT_CONFIG: Omit<ControlPlaneConfig, 'nodeId' | 'region'> = {
  schedulerShards: 4,
  decisionTimeout: 30000, // 30 seconds
  maxPendingDecisions: 1000,
}

/**
 * Control Plane Manager
 * Separates scheduling decisions from task execution
 */
export class ControlPlaneManager {
  private config: ControlPlaneConfig
  private pendingDecisions: Map<string, SchedulingDecision> = new Map()
  private dispatchedCommands: Map<string, ExecutionCommand> = new Map()
  private executionLayer: ((command: ExecutionCommand) => Promise<ExecutionAck>) | null = null
  private nodeRegistry: (() => EdgeNode[]) | null = null
  private scheduler: ((task: Task, nodes: EdgeNode[], constraints: SchedulingConstraints) => string | null) | null = null
  private callbacks: Map<ControlPlaneEvent, Set<ControlPlaneCallback>> = new Map()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: Partial<ControlPlaneConfig> & { nodeId: string; region: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.startCleanupTimer()
  }

  /**
   * Register execution layer (decoupled from control plane)
   */
  registerExecutionLayer(
    executor: (command: ExecutionCommand) => Promise<ExecutionAck>
  ): void {
    this.executionLayer = executor
    logger.info('Execution layer registered with control plane', { nodeId: this.config.nodeId })
  }

  /**
   * Register node registry provider
   */
  registerNodeRegistry(provider: () => EdgeNode[]): void {
    this.nodeRegistry = provider
  }

  /**
   * Register scheduler function
   */
  registerScheduler(
    scheduler: (task: Task, nodes: EdgeNode[], constraints: SchedulingConstraints) => string | null
  ): void {
    this.scheduler = scheduler
  }

  /**
   * Create scheduling decision (control plane only)
   */
  async createDecision(
    task: Task,
    policy: SchedulingPolicy,
    constraints: SchedulingConstraints = {}
  ): Promise<SchedulingDecision | null> {
    // Check capacity
    if (this.pendingDecisions.size >= this.config.maxPendingDecisions) {
      logger.warn('Control plane at capacity, rejecting decision', { taskId: task.id })
      return null
    }

    // Get available nodes
    const nodes = this.nodeRegistry ? this.nodeRegistry() : []
    if (nodes.length === 0) {
      logger.warn('No nodes available for scheduling', { taskId: task.id })
      return null
    }

    // Apply constraints filtering
    const filteredNodes = this.applyConstraints(nodes, constraints)
    if (filteredNodes.length === 0) {
      logger.warn('No nodes match constraints', { taskId: task.id, constraints })
      return null
    }

    // Get scheduling decision from scheduler
    const selectedNodeId = this.scheduler 
      ? this.scheduler(task, filteredNodes, constraints)
      : filteredNodes[0]?.id

    if (!selectedNodeId) {
      return null
    }

    const decision: SchedulingDecision = {
      id: `decision-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      taskId: task.id,
      nodeId: selectedNodeId,
      policy,
      priority: task.priority,
      reason: `Scheduled via ${policy} policy`,
      constraints,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.decisionTimeout,
      status: 'pending',
    }

    this.pendingDecisions.set(decision.id, decision)
    this.emit('decision.created', decision)

    logger.info('Scheduling decision created', {
      decisionId: decision.id,
      taskId: task.id,
      nodeId: selectedNodeId,
      policy,
    })

    return decision
  }

  /**
   * Dispatch decision to execution layer
   */
  async dispatchDecision(decisionId: string): Promise<ExecutionAck | null> {
    const decision = this.pendingDecisions.get(decisionId)
    if (!decision) {
      logger.warn('Decision not found for dispatch', { decisionId })
      return null
    }

    if (!this.executionLayer) {
      logger.error('No execution layer registered')
      return null
    }

    // Create execution command
    const command: ExecutionCommand = {
      decisionId: decision.id,
      taskId: decision.taskId,
      nodeId: decision.nodeId,
      action: 'execute',
      payload: { decision },
      createdAt: Date.now(),
    }

    decision.status = 'dispatched'
    this.dispatchedCommands.set(decision.id, command)
    this.emit('decision.dispatched', { decisionId, nodeId: decision.nodeId })

    try {
      const ack = await this.executionLayer(command)
      
      if (ack.status === 'accepted') {
        decision.status = 'acknowledged'
        this.pendingDecisions.delete(decisionId)
        this.emit('decision.acknowledged', { decisionId, nodeId: decision.nodeId })
      }

      return ack
    } catch (error) {
      logger.error('Failed to dispatch decision', error as Error, { decisionId })
      return null
    }
  }

  /**
   * Cancel a pending decision
   */
  async cancelDecision(decisionId: string, reason: string): Promise<boolean> {
    const decision = this.pendingDecisions.get(decisionId)
    if (!decision) return false

    if (decision.status === 'dispatched' && this.executionLayer) {
      // Send cancel command to execution layer
      await this.executionLayer({
        decisionId,
        taskId: decision.taskId,
        nodeId: decision.nodeId,
        action: 'cancel',
        payload: { reason },
        createdAt: Date.now(),
      })
    }

    this.pendingDecisions.delete(decisionId)
    logger.info('Decision cancelled', { decisionId, reason })
    return true
  }

  /**
   * Get decision by ID
   */
  getDecision(decisionId: string): SchedulingDecision | undefined {
    return this.pendingDecisions.get(decisionId)
  }

  /**
   * Get all pending decisions
   */
  getPendingDecisions(): SchedulingDecision[] {
    return Array.from(this.pendingDecisions.values())
      .filter(d => d.status === 'pending')
  }

  /**
   * Get decisions by node
   */
  getDecisionsByNode(nodeId: string): SchedulingDecision[] {
    return Array.from(this.pendingDecisions.values())
      .filter(d => d.nodeId === nodeId)
  }

  /**
   * Get control plane statistics
   */
  getStats(): {
    pendingDecisions: number
    dispatchedCommands: number
    byPriority: Record<TaskPriority, number>
    byStatus: Record<string, number>
    shardId: number
  } {
    const byPriority: Record<TaskPriority, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    }
    const byStatus: Record<string, number> = {}

    for (const decision of this.pendingDecisions.values()) {
      byPriority[decision.priority]++
      byStatus[decision.status] = (byStatus[decision.status] || 0) + 1
    }

    return {
      pendingDecisions: this.pendingDecisions.size,
      dispatchedCommands: this.dispatchedCommands.size,
      byPriority,
      byStatus,
      shardId: this.getShardId(),
    }
  }

  /**
   * Apply constraints to filter nodes
   */
  private applyConstraints(nodes: EdgeNode[], constraints: SchedulingConstraints): EdgeNode[] {
    return nodes.filter(node => {
      // CPU constraint
      if (constraints.minCpu && (100 - node.cpu) < constraints.minCpu) {
        return false
      }

      // Memory constraint
      if (constraints.minMemory && (100 - node.memory) < constraints.minMemory) {
        return false
      }

      // Storage constraint
      if (constraints.minStorage && node.storage < constraints.minStorage) {
        return false
      }

      // Latency constraint
      if (constraints.maxLatency && node.latency > constraints.maxLatency) {
        return false
      }

      // Region preference
      if (constraints.regionPreference && constraints.regionPreference.length > 0) {
        if (!constraints.regionPreference.includes(node.region)) {
          return false
        }
      }

      // Anti-affinity
      if (constraints.antiAffinity && constraints.antiAffinity.includes(node.id)) {
        return false
      }

      return true
    })
  }

  /**
   * Get shard ID for this control plane instance
   */
  private getShardId(): number {
    let hash = 0
    for (let i = 0; i < this.config.nodeId.length; i++) {
      hash = ((hash << 5) - hash) + this.config.nodeId.charCodeAt(i)
      hash = hash & hash
    }
    return Math.abs(hash) % this.config.schedulerShards
  }

  /**
   * Start cleanup timer for expired decisions
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now()
      for (const [id, decision] of this.pendingDecisions) {
        if (decision.expiresAt < now) {
          decision.status = 'expired'
          this.pendingDecisions.delete(id)
          this.emit('decision.expired', { decisionId: id, taskId: decision.taskId })
          logger.warn('Decision expired', { decisionId: id, taskId: decision.taskId })
        }
      }
    }, 5000)
  }

  /**
   * Stop control plane
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /**
   * Subscribe to events
   */
  on(event: ControlPlaneEvent, callback: ControlPlaneCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: ControlPlaneEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Control plane callback error', error as Error)
      }
    })
  }
}

/**
 * Execution Layer Interface
 * To be implemented by the execution layer
 */
export interface ExecutionLayerInterface {
  execute(command: ExecutionCommand): Promise<ExecutionAck>
  cancel(decisionId: string): Promise<boolean>
  getStatus(nodeId: string): Promise<{ running: number; queued: number }>
  migrate(taskId: string, fromNode: string, toNode: string): Promise<boolean>
}

/**
 * Create control plane instance
 */
export function createControlPlane(config: Partial<ControlPlaneConfig> & { nodeId: string; region: string }): ControlPlaneManager {
  return new ControlPlaneManager(config)
}

// Default instance
export const controlPlane = new ControlPlaneManager({ nodeId: 'default', region: 'default' })
