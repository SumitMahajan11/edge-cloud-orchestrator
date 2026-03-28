/**
 * TaskScheduler - CONTROL PLANE COMPONENT
 * 
 * RESPONSIBILITY: Makes scheduling decisions only
 * DOES NOT: Execute tasks, manage containers, or collect metrics
 * 
 * This service operates purely in the control plane, making decisions about
 * which node should execute a task based on policies and node state.
 * Actual task execution is delegated to the data plane (Edge Agents).
 */

import { PrismaClient } from '@prisma/client'
import Redis from 'ioredis'
import type { Logger } from 'pino'
import type { WebSocketManager } from './websocket-manager'
import axios, { AxiosError } from 'axios'
import { CircuitBreakerRegistry, RetryPolicy, withRetry } from '@edgecloud/circuit-breaker'
import { MultiObjectiveScorer, SchedulingPredictor, type ScoreWeights } from '@edgecloud/ml-scheduler'

const SCHEDULING_INTERVAL = 5000 // 5 seconds
const TASK_TIMEOUT = 300000 // 5 minutes
const REDIS_KEY_TTL = 86400 // 24 hours
const REQUEST_TIMEOUT = 30000 // 30 seconds
const CIRCUIT_BREAKER_THRESHOLD = 5 // failures before opening
const CIRCUIT_BREAKER_RESET_TIME = 60000 // 1 minute
const LEADER_LOCK_TTL = 10000 // 10 seconds leader lock TTL
const LEADER_LOCK_KEY = 'scheduler:leader:lock'

// Local type definitions to avoid Prisma import issues
type TaskStatusType = 'PENDING' | 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
type NodeStatusType = 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'MAINTENANCE'

interface Task {
  id: string
  name: string
  type: string
  status: TaskStatusType
  priority: string
  target: string
  nodeId: string | null
  policy: string
  reason: string
  submittedAt: Date
  maxRetries: number
  input: unknown
  metadata: unknown
}

// Scheduling decision - pure control plane output
export interface SchedulingDecision {
  taskId: string
  nodeId: string
  nodeUrl: string
  policy: string
  reason: string
  estimatedCost?: number
  estimatedLatency?: number
}

export class TaskScheduler {
  private prisma: PrismaClient
  private redis: Redis
  private wsManager: WebSocketManager
  private logger: Logger
  private interval: ReturnType<typeof setInterval> | null = null
  private leaderInterval: ReturnType<typeof setInterval> | null = null
  private queueKey = 'task:queue'
  private circuitBreakerRegistry: CircuitBreakerRegistry
  private retryPolicy: RetryPolicy
  private mlScorer: MultiObjectiveScorer
  private predictor: SchedulingPredictor
  private schedulerWeights: ScoreWeights
  private instanceId: string
  private isLeader = false
  private leaderLockRenewalInterval: ReturnType<typeof setInterval> | null = null
  
  // Integration services
  private priorityScheduler?: any
  private backpressureController?: any
  private gracefulDegradation?: any
  private schedulerRateLimiter?: any
  private coldStartHandler?: any

  constructor(prisma: PrismaClient, redis: Redis, wsManager: WebSocketManager, logger: Logger) {
    this.prisma = prisma
    this.redis = redis
    this.wsManager = wsManager
    this.logger = logger
    this.circuitBreakerRegistry = new CircuitBreakerRegistry()
    this.retryPolicy = new RetryPolicy({
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      jitterType: 'decorrelated',
    })
    
    // Initialize ML scheduler components
    this.predictor = new SchedulingPredictor()
    this.mlScorer = new MultiObjectiveScorer(this.predictor)
    
    // Default weights - can be updated via API
    this.schedulerWeights = {
      latency: 0.2,
      cpu: 0.15,
      memory: 0.15,
      cost: 0.2,
      network: 0.1,
      ml: 0.1,
      health: 0.1,
    }
    
    // Generate unique instance ID for this scheduler instance
    this.instanceId = `scheduler-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  // Setter methods for integration
  setPriorityScheduler(scheduler: any) {
    this.priorityScheduler = scheduler
  }

  setBackpressureController(controller: any) {
    this.backpressureController = controller
  }

  setGracefulDegradation(service: any) {
    this.gracefulDegradation = service
  }

  setSchedulerRateLimiter(limiter: any) {
    this.schedulerRateLimiter = limiter
  }

  setColdStartHandler(handler: any) {
    this.coldStartHandler = handler
  }

  async start() {
    // Attempt to become leader before starting scheduling
    await this.tryBecomeLeader()
    
    // Start leader election heartbeat
    this.leaderInterval = setInterval(() => this.maintainLeadership(), LEADER_LOCK_TTL / 2)
    
    // Only process queue if we are the leader
    this.interval = setInterval(() => {
      if (this.isLeader) {
        this.processQueue()
      }
    }, SCHEDULING_INTERVAL)
    
    // Start reconciliation job (every 5 minutes) to fix drift
    setInterval(() => {
      if (this.isLeader) {
        this.reconcileTaskCounts()
      }
    }, 300000)
    
    this.logger.info({ instanceId: this.instanceId, isLeader: this.isLeader }, 'Task scheduler started')
  }

  /**
   * Reconcile task counts to fix drift between actual and recorded
   */
  private async reconcileTaskCounts(): Promise<void> {
    try {
      const nodes = await this.prisma.edgeNode.findMany({
        select: { id: true, tasksRunning: true }
      })

      for (const node of nodes) {
        // Count actual running tasks for this node
        const actualCount = await this.prisma.task.count({
          where: {
            nodeId: node.id,
            status: { in: ['RUNNING', 'SCHEDULED'] }
          }
        })

        // Update if drift detected
        if (node.tasksRunning !== actualCount) {
          this.logger.warn(
            { nodeId: node.id, recorded: node.tasksRunning, actual: actualCount },
            'Task count drift detected, reconciling'
          )
          
          await this.prisma.edgeNode.update({
            where: { id: node.id },
            data: { tasksRunning: actualCount }
          })
        }
      }
    } catch (error) {
      this.logger.error({ error }, 'Task count reconciliation failed')
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    if (this.leaderInterval) {
      clearInterval(this.leaderInterval)
      this.leaderInterval = null
    }
    if (this.leaderLockRenewalInterval) {
      clearInterval(this.leaderLockRenewalInterval)
      this.leaderLockRenewalInterval = null
    }
    
    // Release leadership on graceful shutdown
    if (this.isLeader) {
      this.releaseLeadership()
    }
    
    this.logger.info({ instanceId: this.instanceId }, 'Task scheduler stopped')
  }

  /**
   * Attempt to acquire leader lock using Redis Redlock pattern
   */
  private async tryBecomeLeader(): Promise<boolean> {
    try {
      // Use SET NX EX for atomic lock acquisition
      const acquired = await this.redis.set(
        LEADER_LOCK_KEY,
        this.instanceId,
        'PX',
        LEADER_LOCK_TTL,
        'NX'
      )
      
      if (acquired === 'OK') {
        this.isLeader = true
        this.logger.info({ instanceId: this.instanceId }, 'Became scheduler leader')
        return true
      }
      
      // Check if current leader is still alive
      const currentLeader = await this.redis.get(LEADER_LOCK_KEY)
      this.logger.debug({ currentLeader, myId: this.instanceId }, 'Leader lock held by another instance')
      return false
    } catch (error) {
      this.logger.error({ error, instanceId: this.instanceId }, 'Failed to acquire leader lock')
      return false
    }
  }

  /**
   * Maintain leadership by renewing the lock
   */
  private async maintainLeadership(): Promise<void> {
    if (!this.isLeader) {
      // Try to become leader if we're not currently
      await this.tryBecomeLeader()
      return
    }

    try {
      // Use Lua script for atomic check-and-renew
      const renewScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("expire", KEYS[1], ARGV[2])
        else
          return 0
        end
      `
      
      const renewed = await this.redis.eval(
        renewScript,
        1,
        LEADER_LOCK_KEY,
        this.instanceId,
        Math.floor(LEADER_LOCK_TTL / 1000)
      )
      
      if (!renewed) {
        // Lost leadership
        this.isLeader = false
        this.logger.warn({ instanceId: this.instanceId }, 'Lost scheduler leadership')
      }
    } catch (error) {
      this.logger.error({ error, instanceId: this.instanceId }, 'Failed to renew leader lock')
      this.isLeader = false
    }
  }

  /**
   * Release leadership lock on shutdown
   */
  private async releaseLeadership(): Promise<void> {
    try {
      const releaseScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `
      
      await this.redis.eval(releaseScript, 1, LEADER_LOCK_KEY, this.instanceId)
      this.isLeader = false
      this.logger.info({ instanceId: this.instanceId }, 'Released scheduler leadership')
    } catch (error) {
      this.logger.error({ error, instanceId: this.instanceId }, 'Failed to release leadership')
    }
  }

  /**
   * Check if this scheduler instance is currently the leader
   */
  isCurrentlyLeader(): boolean {
    return this.isLeader
  }

  async enqueue(task: Task) {
    // Add to Redis queue with priority
    const priority = this.getPriorityScore(task)
    await this.redis.zadd(this.queueKey, priority, task.id)
    // Set TTL on the queue key
    await this.redis.expire(this.queueKey, REDIS_KEY_TTL)
    this.logger.info({ taskId: task.id, priority }, 'Task enqueued')
  }

  async dequeue(taskId: string) {
    // Remove task from queue
    await this.redis.zrem(this.queueKey, taskId)
    this.logger.info({ taskId }, 'Task dequeued')
  }

  private getPriorityScore(task: Task): number {
    const now = Date.now()
    const age = now - task.submittedAt.getTime()
    const ageScore = Math.min(age / 60000, 10) // Max 10 points for age

    const priorityScores: Record<string, number> = {
      CRITICAL: 100,
      HIGH: 75,
      MEDIUM: 50,
      LOW: 25,
    }

    return (priorityScores[task.priority] || 0) + ageScore
  }

  // Circuit breaker methods using CircuitBreakerRegistry with Redis sync
  private async isCircuitOpen(nodeId: string): Promise<boolean> {
    // Check distributed state first (Redis)
    const distributedState = await this.redis.get(`circuit:${nodeId}:state`);
    if (distributedState === 'OPEN') {
      return true;
    }

    const breaker = this.circuitBreakerRegistry.getOrCreate(nodeId, {
      failureThreshold: CIRCUIT_BREAKER_THRESHOLD,
      resetTimeout: CIRCUIT_BREAKER_RESET_TIME,
      name: nodeId,
    });
    
    const isOpen = breaker.getState() === 'OPEN';
    
    // Sync to Redis if open
    if (isOpen) {
      await this.redis.setex(`circuit:${nodeId}:state`, 60, 'OPEN');
    }
    
    return isOpen;
  }

  private async recordSuccess(nodeId: string) {
    const breaker = this.circuitBreakerRegistry.get(nodeId);
    if (breaker) {
      breaker.forceClose();
    }
    // Clear distributed state
    await this.redis.del(`circuit:${nodeId}:state`);
  }

  private async recordFailure(nodeId: string) {
    const breaker = this.circuitBreakerRegistry.getOrCreate(nodeId, {
      failureThreshold: CIRCUIT_BREAKER_THRESHOLD,
      resetTimeout: CIRCUIT_BREAKER_RESET_TIME,
      name: nodeId,
    });
    
    // Execute a failing operation to trigger failure recording
    await breaker.execute(async () => {
      throw new Error('Node failure recorded');
    }).catch(() => {
      // Expected failure for recording
    });

    // Sync to Redis if now open
    if (breaker.getState() === 'OPEN') {
      await this.redis.setex(`circuit:${nodeId}:state`, 60, 'OPEN');
    }
  }

  /**
   * Get circuit breaker health for all nodes
   */
  getCircuitBreakerHealth() {
    return this.circuitBreakerRegistry.healthCheck();
  }

  private async processQueue() {
    try {
      // Check backpressure before processing
      if (this.backpressureController) {
        const decision = await this.backpressureController.shouldAcceptTask('MEDIUM')
        if (decision.shouldThrottle) {
          this.logger.debug({ reason: decision.reason }, 'Backpressure throttling task processing')
          return
        }
      }

      // Get highest priority task (from priority scheduler if available)
      let taskId: string | null = null
      
      if (this.priorityScheduler) {
        const batch = await this.priorityScheduler.getNextBatch(1)
        if (batch.length > 0) {
          taskId = batch[0].id
        }
      } else {
        // Fallback to legacy queue
        const taskIds = await this.redis.zrevrange(this.queueKey, 0, 0)
        taskId = taskIds[0] || null
      }

      if (!taskId) return

      // Get task from database
      const task = await this.prisma.task.findUnique({ where: { id: taskId } })

      if (!task || task.status !== 'PENDING') {
        // Remove from queue if not pending
        await this.redis.zrem(this.queueKey, taskId)
        return
      }

      // Check rate limiting
      if (this.schedulerRateLimiter) {
        const userId = (task as any).userId || 'system'
        const rateLimitCheck = await this.schedulerRateLimiter.checkRateLimit(taskId, userId, 'pending')
        if (!rateLimitCheck.allowed) {
          this.logger.debug({ taskId, reason: rateLimitCheck.reason }, 'Rate limit exceeded, deferring task')
          return
        }
      }

      // Find suitable node
      const node = await this.findNode(task)

      if (!node) {
        this.logger.debug({ taskId }, 'No suitable node found, task remains in queue')
        return
      }

      // Check circuit breaker
      if (await this.isCircuitOpen(node.id)) {
        this.logger.debug({ taskId, nodeId: node.id }, 'Circuit breaker open, skipping node')
        return
      }

      // Remove from queue
      await this.redis.zrem(this.queueKey, taskId)

      // Record rate limit usage
      if (this.schedulerRateLimiter) {
        const userId = (task as any).userId || 'system'
        await this.schedulerRateLimiter.recordTaskScheduled(userId, node.id)
      }

      // Assign task to node
      await this.assignTask(task, node)

    } catch (error) {
      this.logger.error({ error }, 'Error processing task queue')
    }
  }

  private async findNode(task: Task): Promise<{ id: string; url: string } | null> {
    const nodes = await this.prisma.edgeNode.findMany({
      where: {
        status: 'ONLINE',
        isMaintenanceMode: false,
        tasksRunning: { lt: 10 }, // Max tasks per node
      },
      orderBy: [
        { tasksRunning: 'asc' }, // Prefer least loaded
        { latency: 'asc' }, // Then lowest latency
      ],
    })

    if (nodes.length === 0) return null

    // Filter out nodes with open circuit breakers
    const circuitStates = await Promise.all(
      nodes.map(async (n: { id: string }) => ({ id: n.id, isOpen: await this.isCircuitOpen(n.id) }))
    )
    const openCircuits = new Set(circuitStates.filter(s => s.isOpen).map(s => s.id))
    const availableNodes = nodes.filter((n: { id: string }) => !openCircuits.has(n.id))
    if (availableNodes.length === 0) {
      this.logger.warn('All nodes have open circuit breakers')
      return null
    }

    // Apply scheduling policy
    switch (task.policy) {
      case 'latency-aware':
        return this.selectByLatency(availableNodes)
      case 'cost-aware':
        return await this.selectByCost(availableNodes, task)
      case 'round-robin':
        return await this.selectRoundRobin(availableNodes)
      case 'ml-optimized':
        return await this.selectByMLScore(availableNodes, task)
      case 'load-balanced':
      default:
        return availableNodes[0]
    }
  }

  private selectByLatency(nodes: { id: string; url: string; latency: number }[]): { id: string; url: string } | null {
    const sorted = [...nodes].sort((a, b) => a.latency - b.latency)
    return sorted[0] || null
  }

  /**
   * Cost-aware node selection using realistic multi-factor cost model
   * 
   * Factors considered:
   * - Compute cost (hourly rate × estimated duration)
   * - Data transfer costs (ingress/egress)
   * - Cross-region network premiums
   * - Spot instance discounts
   * - Node utilization (bin-packing optimization)
   */
  private async selectByCost(
    nodes: { id: string; url: string; costPerHour: number; region: string; availabilityZone?: string }[],
    task?: Task
  ): Promise<{ id: string; url: string } | null> {
    // Lazy import to avoid circular dependencies
    const { CostOptimizer, createAWSCostProfile } = await import('./cost-optimizer.js')
    
    const optimizer = new CostOptimizer()
    const controlPlaneRegion = process.env.CONTROL_PLANE_REGION || 'us-east-1'
    
    // Build node cost profiles
    const nodeProfiles = nodes.map(node => ({
      nodeId: node.id,
      region: node.region,
      availabilityZone: node.availabilityZone || `${node.region}a`,
      costFactors: createAWSCostProfile(node.region),
      currentUtilization: { cpuPercent: 50, memoryPercent: 50 }, // Would come from metrics
    }))

    // Estimate task resources (would be based on task type/history)
    const taskEstimate = {
      estimatedDurationMinutes: 5, // Default estimate
      cpuCores: 1,
      memoryGB: 2,
      storageGB: 10,
      inputDataGB: 0.1,
      outputDataGB: 0.1,
      requiresGPU: false,
    }

    // Find most cost-effective node
    const result = optimizer.selectMostCostEffective(
      taskEstimate,
      nodeProfiles,
      controlPlaneRegion
    )

    if (result) {
      const selectedNode = nodes.find(n => n.id === result.node.nodeId)
      if (selectedNode) {
        this.logger.info(
          { 
            nodeId: selectedNode.id, 
            totalCost: result.estimate.totalCostUSD,
            breakdown: result.estimate.breakdown,
            confidence: result.estimate.confidence,
          },
          'Selected node using cost-aware optimizer'
        )
        return selectedNode
      }
    }

    // Fallback to simple sorting if cost optimization fails
    const sorted = [...nodes].sort((a, b) => a.costPerHour - b.costPerHour)
    return sorted[0] || null
  }

  private async selectRoundRobin(nodes: { id: string; url: string }[]): Promise<{ id: string; url: string } | null> {
    const lastIndex = parseInt(await this.redis.get('scheduler:round-robin:index') || '0', 10)
    const nextIndex = (lastIndex + 1) % nodes.length
    await this.redis.setex('scheduler:round-robin:index', REDIS_KEY_TTL, nextIndex.toString())
    return nodes[nextIndex] || null
  }

  /**
   * ML-optimized node selection using multi-objective scoring
   * 
   * Factors: latency, cpu, memory, cost, network, ML prediction, health
   * Respects graceful degradation settings
   */
  private async selectByMLScore(
    nodes: { id: string; url: string; latency?: number; cpuUsage?: number; memoryUsage?: number; costPerHour?: number; bandwidthInMbps?: number }[],
    task: Task
  ): Promise<{ id: string; url: string } | null> {
    if (nodes.length === 0) return null

    // Check graceful degradation for ML scoring
    if (this.gracefulDegradation && !this.gracefulDegradation.isFeatureEnabled('ml-scoring')) {
      this.logger.debug('ML scoring disabled by graceful degradation, using weighted fallback')
      // Use weighted scoring without ML
      const algorithm = this.gracefulDegradation.getSchedulingAlgorithm()
      if (algorithm === 'round-robin') {
        return await this.selectRoundRobin(nodes)
      }
      // Fall through to weighted calculation
    }

    // Convert nodes to scorer format
    const scoredNodes = nodes.map(node => {
      const score = this.calculateNodeScore(node, task)
      return { ...node, score }
    })

    // Sort by score descending
    scoredNodes.sort((a, b) => b.score - a.score)

    const selectedNode = scoredNodes[0]
    
    this.logger.info(
      {
        nodeId: selectedNode.id,
        score: selectedNode.score,
        taskId: task.id,
        algorithm: this.gracefulDegradation?.getSchedulingAlgorithm() || 'ml',
      },
      'Selected node using ML-optimized scorer'
    )

    return { id: selectedNode.id, url: selectedNode.url }
  }

  /**
   * Calculate node score based on weighted factors
   */
  private calculateNodeScore(
    node: { id: string; latency?: number; cpuUsage?: number; memoryUsage?: number; costPerHour?: number; bandwidthInMbps?: number },
    _task: Task
  ): number {
    const weights = this.schedulerWeights

    // Normalize each factor to 0-1 scale
    const latencyScore = node.latency ? 1 - Math.min(node.latency / 500, 1) : 0.5
    const cpuScore = node.cpuUsage !== undefined ? 1 - node.cpuUsage / 100 : 0.5
    const memoryScore = node.memoryUsage !== undefined ? 1 - node.memoryUsage / 100 : 0.5
    const costScore = node.costPerHour ? 1 - Math.min(node.costPerHour, 1) : 0.5
    const networkScore = node.bandwidthInMbps ? Math.min(node.bandwidthInMbps / 1000, 1) : 0.5

    // ML prediction score (would use predictor in production)
    const mlPredictionScore = 0.5 // Default prediction

    // Health score (would come from health monitor)
    const healthScore = 0.9 // Default health

    // Weighted sum
    return (
      weights.latency * latencyScore +
      weights.cpu * cpuScore +
      weights.memory * memoryScore +
      weights.cost * costScore +
      weights.network * networkScore +
      weights.ml * mlPredictionScore +
      weights.health * healthScore
    )
  }

  /**
   * Update scheduler weights (via API)
   */
  setSchedulerWeights(weights: Partial<ScoreWeights>): void {
    this.schedulerWeights = { ...this.schedulerWeights, ...weights }
    this.logger.info({ weights: this.schedulerWeights }, 'Updated scheduler weights')
  }

  /**
   * Get current scheduler weights
   */
  getSchedulerWeights(): ScoreWeights {
    return { ...this.schedulerWeights }
  }

  private async assignTask(task: Task, node: { id: string; url: string }) {
    this.logger.info({ taskId: task.id, nodeId: node.id }, 'Assigning task to node')

    // Update task status
    await this.prisma.task.update({
      where: { id: task.id },
      data: {
        nodeId: node.id,
        status: 'SCHEDULED',
        reason: `Scheduled on node ${node.id}`,
      },
    })

    // Send to edge agent with circuit breaker protection
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

      const requestId = `${task.id}-${Date.now()}`
      
      await axios.post(`${node.url}/run-task`, {
        taskId: task.id,
        taskName: task.name,
        type: task.type,
        input: task.input,
        timeout: TASK_TIMEOUT,
      }, {
        timeout: REQUEST_TIMEOUT,
        signal: controller.signal,
        headers: {
          'X-Request-ID': requestId,
          'X-Trace-ID': requestId,
          'X-Source': 'task-scheduler',
        },
      })

      clearTimeout(timeoutId)

      // Record success for circuit breaker
      await this.recordSuccess(node.id)

      // Mark as running
      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          status: 'RUNNING',
        },
      })

      // Update node task count
      await this.prisma.edgeNode.update({
        where: { id: node.id },
        data: { tasksRunning: { increment: 1 } },
      })

      this.wsManager.broadcast('task:started', {
        taskId: task.id,
        nodeId: node.id,
        timestamp: new Date().toISOString(),
      })

    } catch (error) {
      // Record failure for circuit breaker
      await this.recordFailure(node.id)

      const errorMessage = error instanceof AxiosError 
        ? `HTTP ${error.response?.status || 'unknown'}: ${error.message}`
        : error instanceof Error 
          ? error.message 
          : 'Unknown error'

      this.logger.error({ taskId: task.id, nodeId: node.id, error: errorMessage }, 'Failed to assign task to node')

      // Mark as failed and potentially retry
      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
        },
      })

      // Re-enqueue if retries available
      const executionCount = await this.prisma.taskExecution.count({ where: { taskId: task.id } })
      if (executionCount < task.maxRetries) {
        const retryTask = await this.prisma.task.create({
          data: {
            name: task.name,
            type: task.type,
            priority: task.priority,
            target: task.target,
            policy: task.policy,
            reason: `Retry after: ${errorMessage}`,
            input: task.input,
            metadata: { ...task.metadata as object, retryOf: task.id },
            maxRetries: task.maxRetries,
          } as any,
        })
        
        // Enqueue retry task
        await this.enqueue(retryTask as any)
      }
    }
  }

  async handleTaskCompletion(taskId: string, nodeId: string, result: {
    status: 'completed' | 'failed'
    output?: unknown
    error?: string
    duration: number
  }) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } })

    if (!task) {
      this.logger.warn({ taskId }, 'Task not found for completion')
      return
    }

    // Record success for circuit breaker
    await this.recordSuccess(nodeId)

    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: result.status === 'completed' ? 'COMPLETED' : 'FAILED',
      },
    })

    // Update node task count (with check to prevent negative)
    const node = await this.prisma.edgeNode.findUnique({
      where: { id: nodeId },
      select: { tasksRunning: true }
    })
    
    if (node && node.tasksRunning > 0) {
      await this.prisma.edgeNode.update({
        where: { id: nodeId },
        data: { tasksRunning: { decrement: 1 } },
      })
    }

    this.wsManager.broadcast(`task:${result.status}`, {
      taskId,
      nodeId,
      duration: result.duration,
      timestamp: new Date().toISOString(),
    })
  }

  getQueueLength(): Promise<number> {
    return this.redis.zcard(this.queueKey)
  }

  async getQueuePosition(taskId: string): Promise<number> {
    const rank = await this.redis.zrevrank(this.queueKey, taskId)
    return rank !== null ? rank + 1 : -1
  }
}
