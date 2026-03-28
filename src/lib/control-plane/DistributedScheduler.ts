/**
 * Distributed Scheduler with Sharding
 * Eliminates single scheduler bottleneck through horizontal scaling
 */

import { logger } from '../logger'
import type { Task, EdgeNode, SchedulingPolicy } from '../../types'

// Types
export interface ShardConfig {
  shardId: number
  totalShards: number
  hashKey: 'task-type' | 'region' | 'priority' | 'round-robin'
  syncInterval: number
  rebalanceThreshold: number
}

export interface ShardInfo {
  shardId: number
  nodeIds: string[]
  taskCount: number
  load: number
  lastSync: number
  isHealthy: boolean
}

export interface SchedulerShard {
  id: number
  nodes: Set<string>
  tasks: Map<string, Task>
  load: number
  lastHeartbeat: number
}

export interface DistributedScheduleResult {
  taskId: string
  nodeId: string
  shardId: number
  policy: SchedulingPolicy
  timestamp: number
}

type ShardEvent = 'shard.assigned' | 'shard.rebalanced' | 'shard.failed' | 'task.scheduled'
type ShardCallback = (event: ShardEvent, data: unknown) => void

const DEFAULT_CONFIG: Omit<ShardConfig, 'shardId' | 'totalShards'> = {
  hashKey: 'task-type',
  syncInterval: 5000,
  rebalanceThreshold: 0.2, // 20% imbalance triggers rebalance
}

/**
 * Distributed Scheduler with consistent hashing
 */
export class DistributedScheduler {
  private config: ShardConfig
  private shards: Map<number, SchedulerShard> = new Map()
  private nodeToShard: Map<string, number> = new Map()
  private taskQueue: Map<number, Task[]> = new Map()
  private roundRobinIndex = 0
  private syncTimer: ReturnType<typeof setInterval> | null = null
  private callbacks: Map<ShardEvent, Set<ShardCallback>> = new Map()
  private nodeProvider: (() => EdgeNode[]) | null = null
  private policyApplier: ((task: Task, nodes: EdgeNode[], policy: SchedulingPolicy) => string | null) | null = null

  constructor(config: Partial<ShardConfig> & { shardId: number; totalShards: number }) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.initializeShards()
  }

  /**
   * Initialize shards
   */
  private initializeShards(): void {
    for (let i = 0; i < this.config.totalShards; i++) {
      this.shards.set(i, {
        id: i,
        nodes: new Set(),
        tasks: new Map(),
        load: 0,
        lastHeartbeat: Date.now(),
      })
      this.taskQueue.set(i, [])
    }
  }

  /**
   * Set node provider
   */
  setNodeProvider(provider: () => EdgeNode[]): void {
    this.nodeProvider = provider
  }

  /**
   * Set policy applier
   */
  setPolicyApplier(
    applier: (task: Task, nodes: EdgeNode[], policy: SchedulingPolicy) => string | null
  ): void {
    this.policyApplier = applier
  }

  /**
   * Register a node to a shard
   */
  registerNode(node: EdgeNode): number {
    const shardId = this.getShardForNode(node)
    const shard = this.shards.get(shardId)
    
    if (shard) {
      shard.nodes.add(node.id)
      this.nodeToShard.set(node.id, shardId)
      this.emit('shard.assigned', { nodeId: node.id, shardId })
      logger.info('Node registered to shard', { nodeId: node.id, shardId })
    }
    
    return shardId
  }

  /**
   * Unregister a node
   */
  unregisterNode(nodeId: string): void {
    const shardId = this.nodeToShard.get(nodeId)
    if (shardId !== undefined) {
      const shard = this.shards.get(shardId)
      if (shard) {
        shard.nodes.delete(nodeId)
      }
      this.nodeToShard.delete(nodeId)
    }
  }

  /**
   * Get shard for a node using consistent hashing
   */
  private getShardForNode(node: EdgeNode): number {
    const key = `${node.region}:${node.id}`
    return this.hash(key) % this.config.totalShards
  }

  /**
   * Get shard for a task
   */
  private getShardForTask(task: Task): number {
    let key: string
    
    switch (this.config.hashKey) {
      case 'task-type':
        key = task.type
        break
      case 'region':
        key = task.nodeId || 'default'
        break
      case 'priority':
        key = task.priority
        break
      case 'round-robin':
        this.roundRobinIndex = (this.roundRobinIndex + 1) % this.config.totalShards
        return this.roundRobinIndex
      default:
        key = task.type
    }
    
    return this.hash(key) % this.config.totalShards
  }

  /**
   * Hash function for consistent hashing
   */
  private hash(key: string): number {
    let hash = 5381
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) + hash) + key.charCodeAt(i)
    }
    return Math.abs(hash)
  }

  /**
   * Schedule a task across shards
   */
  async scheduleTask(task: Task, policy: SchedulingPolicy): Promise<DistributedScheduleResult | null> {
    const shardId = this.getShardForTask(task)
    const shard = this.shards.get(shardId)
    
    if (!shard || shard.nodes.size === 0) {
      // Try to find another shard with nodes
      const fallbackShard = this.findAvailableShard()
      if (!fallbackShard) {
        logger.warn('No available shards for task', { taskId: task.id })
        return null
      }
      return this.scheduleOnShard(task, policy, fallbackShard)
    }
    
    return this.scheduleOnShard(task, policy, shardId)
  }

  /**
   * Schedule task on specific shard
   */
  private async scheduleOnShard(task: Task, policy: SchedulingPolicy, shardId: number): Promise<DistributedScheduleResult | null> {
    const shard = this.shards.get(shardId)
    if (!shard) return null

    // Get nodes for this shard
    const nodes = this.nodeProvider ? this.nodeProvider().filter(n => shard.nodes.has(n.id)) : []
    
    if (nodes.length === 0) {
      // Queue task for later
      const queue = this.taskQueue.get(shardId) || []
      queue.push(task)
      this.taskQueue.set(shardId, queue)
      logger.info('Task queued (no nodes available)', { taskId: task.id, shardId })
      return null
    }

    // Apply scheduling policy
    const selectedNodeId = this.policyApplier 
      ? this.policyApplier(task, nodes, policy)
      : nodes[0]?.id

    if (!selectedNodeId) {
      return null
    }

    // Update shard load
    shard.tasks.set(task.id, task)
    shard.load = shard.tasks.size / Math.max(shard.nodes.size, 1)

    const result: DistributedScheduleResult = {
      taskId: task.id,
      nodeId: selectedNodeId,
      shardId,
      policy,
      timestamp: Date.now(),
    }

    this.emit('task.scheduled', result)
    logger.info('Task scheduled on shard', { taskId: task.id, nodeId: selectedNodeId, shardId })

    return result
  }

  /**
   * Find an available shard
   */
  private findAvailableShard(): number | null {
    for (const [shardId, shard] of this.shards) {
      if (shard.nodes.size > 0) {
        return shardId
      }
    }
    return null
  }

  /**
   * Rebalance shards if load is imbalanced
   */
  rebalance(): { moved: number; from: number[]; to: number[] } {
    const loads = Array.from(this.shards.values()).map(s => s.load)
    const avgLoad = loads.reduce((a, b) => a + b, 0) / loads.length
    
    const overloaded: number[] = []
    const underloaded: number[] = []
    
    for (const [shardId, shard] of this.shards) {
      const deviation = Math.abs(shard.load - avgLoad) / avgLoad
      if (deviation > this.config.rebalanceThreshold) {
        if (shard.load > avgLoad) {
          overloaded.push(shardId)
        } else {
          underloaded.push(shardId)
        }
      }
    }

    let moved = 0
    
    // Move nodes from overloaded to underloaded shards
    for (const fromShardId of overloaded) {
      const fromShard = this.shards.get(fromShardId)
      if (!fromShard || fromShard.nodes.size === 0) continue
      
      for (const toShardId of underloaded) {
        if (fromShard.nodes.size <= 1) break // Keep at least one node
        
        const nodeToMove = Array.from(fromShard.nodes)[0]
        fromShard.nodes.delete(nodeToMove)
        
        const toShard = this.shards.get(toShardId)
        if (toShard) {
          toShard.nodes.add(nodeToMove)
          this.nodeToShard.set(nodeToMove, toShardId)
          moved++
        }
      }
    }

    if (moved > 0) {
      this.emit('shard.rebalanced', { moved, overloaded, underloaded })
      logger.info('Shards rebalanced', { moved, overloaded, underloaded })
    }

    return { moved, from: overloaded, to: underloaded }
  }

  /**
   * Get shard information
   */
  getShardInfo(): ShardInfo[] {
    return Array.from(this.shards.values()).map(shard => ({
      shardId: shard.id,
      nodeIds: Array.from(shard.nodes),
      taskCount: shard.tasks.size,
      load: shard.load,
      lastSync: shard.lastHeartbeat,
      isHealthy: Date.now() - shard.lastHeartbeat < 30000,
    }))
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalShards: number
    totalNodes: number
    totalTasks: number
    avgLoad: number
    maxLoad: number
    minLoad: number
    queuedTasks: number
  } {
    let totalNodes = 0
    let totalTasks = 0
    let totalLoad = 0
    let maxLoad = 0
    let minLoad = Infinity
    let queuedTasks = 0

    for (const shard of this.shards.values()) {
      totalNodes += shard.nodes.size
      totalTasks += shard.tasks.size
      totalLoad += shard.load
      maxLoad = Math.max(maxLoad, shard.load)
      minLoad = Math.min(minLoad, shard.load)
    }

    for (const queue of this.taskQueue.values()) {
      queuedTasks += queue.length
    }

    return {
      totalShards: this.config.totalShards,
      totalNodes,
      totalTasks,
      avgLoad: totalLoad / this.config.totalShards,
      maxLoad,
      minLoad: minLoad === Infinity ? 0 : minLoad,
      queuedTasks,
    }
  }

  /**
   * Mark task complete
   */
  completeTask(taskId: string, shardId: number): void {
    const shard = this.shards.get(shardId)
    if (shard) {
      shard.tasks.delete(taskId)
      shard.load = shard.tasks.size / Math.max(shard.nodes.size, 1)
    }
  }

  /**
   * Start sync timer
   */
  startSync(): void {
    this.syncTimer = setInterval(() => {
      this.sync()
    }, this.config.syncInterval)
  }

  /**
   * Stop sync timer
   */
  stopSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
      this.syncTimer = null
    }
  }

  /**
   * Sync shard state
   */
  private sync(): void {
    const now = Date.now()
    for (const shard of this.shards.values()) {
      shard.lastHeartbeat = now
    }
  }

  /**
   * Subscribe to events
   */
  on(event: ShardEvent, callback: ShardCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: ShardEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Distributed scheduler callback error', error as Error)
      }
    })
  }
}

/**
 * Create distributed scheduler
 */
export function createDistributedScheduler(config: Partial<ShardConfig> & { shardId: number; totalShards: number }): DistributedScheduler {
  return new DistributedScheduler(config)
}

// Default instance
export const distributedScheduler = new DistributedScheduler({ shardId: 0, totalShards: 4 })
