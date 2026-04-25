import { 
  selectNode, 
  LeaderElection, 
  evaluateBackpressure, 
  type ScoreWeights,
  tracer,
  getTraceId,
  getRequestId,
  SpanKind,
  SpanStatusCode
} from '@edgecloud/shared-kernel';
import { SchedulingPredictor, MLScheduler, ModelRegistry, DriftDetector, FeatureExtractor } from '@edgecloud/ml-scheduler';
import axios from 'axios';
import { CircuitBreakerRegistry } from '@edgecloud/circuit-breaker';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import type { Logger } from 'pino';
import { MetricsCollector } from '@edgecloud/observability';

import type { WebSocketManager } from './websocket-manager';

const SCHEDULING_INTERVAL = 5000; // 5 seconds
const TASK_TIMEOUT = 300000; // 5 minutes
const REDIS_KEY_TTL = 86400; // 24 hours
const REQUEST_TIMEOUT = 30000; // 30 seconds
const CIRCUIT_BREAKER_THRESHOLD = 5; // failures before opening
const CIRCUIT_BREAKER_RESET_TIME = 60000; // 1 minute
const LEADER_LOCK_TTL = 10000; // 10 seconds leader lock TTL
const LEADER_LOCK_KEY = 'scheduler:leader:lock';

// Local type definitions to avoid Prisma import issues
type TaskStatusType =
  | 'PENDING'
  | 'SCHEDULED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'FAILED_PERMANENT'
  | 'CANCELLED';

interface Task {
  id: string;
  name: string;
  type: string;
  status: TaskStatusType;
  priority: string;
  target: string;
  nodeId: string | null;
  policy: string;
  reason: string;
  submittedAt: Date;
  maxRetries: number;
  input: unknown;
  metadata: unknown;
}

// Scheduling decision - pure control plane output
export interface SchedulingDecision {
  taskId: string;
  nodeId: string;
  nodeUrl: string;
  policy: string;
  reason: string;
  estimatedCost?: number;
  estimatedLatency?: number;
}

export class TaskScheduler {
  private prisma: PrismaClient;
  private redis: Redis;
  private wsManager: WebSocketManager;
  private logger: Logger;
  private leaderElection: LeaderElection;
  private interval: ReturnType<typeof setInterval> | null = null;
  private hotswapInterval: ReturnType<typeof setInterval> | null = null;
  private queueKey = 'task:queue';
  private circuitBreakerRegistry: CircuitBreakerRegistry;
  private schedulerWeights: ScoreWeights;
  private instanceId: string;
  
  // ML Scheduler components
  private mlScheduler: MLScheduler;
  private driftDetector: DriftDetector;
  private modelRegistry: ModelRegistry;
  public featureExtractor: FeatureExtractor;
  private metrics: MetricsCollector;

  // Integration services
  private priorityScheduler?: any;
  private backpressureController?: any;
  private _gracefulDegradation?: any;
  private schedulerRateLimiter?: any;

  constructor(
    prisma: PrismaClient,
    redis: Redis,
    wsManager: WebSocketManager,
    logger: Logger,
  ) {
    this.prisma = prisma;
    this.redis = redis;
    this.wsManager = wsManager;
    this.logger = logger;
    this.circuitBreakerRegistry = new CircuitBreakerRegistry();

    // Initialize metrics
    this.metrics = new MetricsCollector({
      serviceName: 'orchestrator-api',
      serviceVersion: '2.0.0',
    });

    // Initialize ML scheduler components
    const predictor = new SchedulingPredictor();
    this.modelRegistry = new ModelRegistry(this.redis);
    this.driftDetector = new DriftDetector(this.metrics);
    this.mlScheduler = new MLScheduler(predictor, this.modelRegistry, this.driftDetector, this.metrics);
    this.featureExtractor = new FeatureExtractor((prisma as any)._pool || (prisma as any).$pool); // Attempt to get underlying pool

    // Default weights - can be updated via API
    this.schedulerWeights = {
      latency: 0.2,
      cpu: 0.15,
      memory: 0.15,
      cost: 0.2,
      network: 0.1,
      ml: 0.1,
      health: 0.1,
    };

    this.instanceId = `scheduler-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    this.leaderElection = new LeaderElection(this.redis, this.logger, {
      lockKey: LEADER_LOCK_KEY,
      ttl: LEADER_LOCK_TTL,
      unlockOnStop: true,
    });
  }

  // Setter methods for integration
  setPriorityScheduler(scheduler: any) {
    this.priorityScheduler = scheduler;
  }

  setBackpressureController(controller: any) {
    this.backpressureController = controller;
  }

  setGracefulDegradation(service: any) {
    this._gracefulDegradation = service;
  }

  setSchedulerRateLimiter(limiter: any) {
    this.schedulerRateLimiter = limiter;
  }

  setColdStartHandler(_handler: any) {
    // Cold start handler stored for future use
  }

  async start() {
    await this.leaderElection.start(this.instanceId, LEADER_LOCK_TTL);

    // Initial check
    if (this.leaderElection.isCurrentlyLeader()) {
      this.processQueue();
    }

    // Only process queue if we are the leader
    this.interval = setInterval(() => {
      if (this.leaderElection.isCurrentlyLeader()) {
        this.processQueue();
      }
    }, SCHEDULING_INTERVAL);

    // ML Model Hot-swap monitoring (poll every 60s)
    this.hotswapInterval = setInterval(async () => {
      await this.checkActiveModel();
    }, 60000);

    // Initial ML check
    await this.checkActiveModel();

    // Start reconciliation job (every 5 minutes) to fix drift
    setInterval(() => {
      if (this.leaderElection.isCurrentlyLeader()) {
        this.reconcileTaskCounts();
      }
    }, 300000);

    // Start decision retention cleanup (every 24 hours)
    setInterval(() => {
      if (this.leaderElection.isCurrentlyLeader()) {
        this.runRetentionCleanup();
      }
    }, 86400000);

    this.logger.info(
      {
        instanceId: this.instanceId,
        isLeader: this.leaderElection.isCurrentlyLeader(),
      },
      'Task scheduler started',
    );
  }

  private async checkActiveModel() {
    try {
      await this.mlScheduler.checkHotSwap();
    } catch (error) {
      this.logger.error({ error }, 'Failed to check/update active ML model');
    }
  }

  /**
   * Reconcile task counts to fix drift between actual and recorded
   */
  private async reconcileTaskCounts(): Promise<void> {
    try {
      const nodes = await this.prisma.edgeNode.findMany({
        select: { id: true, tasksRunning: true },
      });

      for (const node of nodes) {
        // Count actual running tasks for this node
        const actualCount = await this.prisma.task.count({
          where: {
            nodeId: node.id,
            status: { in: ['RUNNING', 'SCHEDULED'] },
          },
        });

        // Update if drift detected
        if (node.tasksRunning !== actualCount) {
          this.logger.warn(
            {
              nodeId: node.id,
              recorded: node.tasksRunning,
              actual: actualCount,
            },
            'Task count drift detected, reconciling',
          );

          await this.prisma.edgeNode.update({
            where: { id: node.id },
            data: { tasksRunning: actualCount },
          });
        }
      }
    } catch (error) {
      this.logger.error({ error }, 'Task count reconciliation failed');
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.hotswapInterval) {
      clearInterval(this.hotswapInterval);
      this.hotswapInterval = null;
    }

    this.leaderElection.stop();

    this.logger.info({ instanceId: this.instanceId }, 'Task scheduler stopped');
  }

  /**
   * Check if this scheduler instance is currently the leader
   */
  isCurrentlyLeader(): boolean {
    return this.leaderElection.isCurrentlyLeader();
  }

  async enqueue(task: Task) {
    // Add to Redis queue with priority
    const priority = this.getPriorityScore(task);
    await this.redis.zadd(this.queueKey, priority, task.id);
    // Set TTL on the queue key
    await this.redis.expire(this.queueKey, REDIS_KEY_TTL);
    this.logger.info({ taskId: task.id, priority }, 'Task enqueued');
  }

  async dequeue(taskId: string) {
    // Remove task from queue
    await this.redis.zrem(this.queueKey, taskId);
    this.logger.info({ taskId }, 'Task dequeued');
  }

  private getPriorityScore(task: Task): number {
    const now = Date.now();
    const age = now - task.submittedAt.getTime();
    const ageScore = Math.min(age / 60000, 10); // Max 10 points for age

    const priorityScores: Record<string, number> = {
      CRITICAL: 100,
      HIGH: 75,
      MEDIUM: 50,
      LOW: 25,
    };

    return (priorityScores[task.priority] || 0) + ageScore;
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

  /**
   * Get circuit breaker health for all nodes
   */
  getCircuitBreakerHealth() {
    return this.circuitBreakerRegistry.healthCheck();
  }

  private async processQueue() {
    await tracer.startActiveSpan('scheduler:process_queue', async (span) => {
      try {
        // Check backpressure before processing
        if (this.backpressureController) {
          // Collect metrics for backpressure evaluation
          const metrics = await this.getSystemMetrics();
          const decision = evaluateBackpressure(
            metrics,
            'MEDIUM',
            this.backpressureController.getConfig(),
          );

          if (decision.shouldThrottle) {
            span.setAttribute('scheduler.throttled', true);
            span.setAttribute('scheduler.throttle_reason', decision.reason);
            this.logger.debug(
              { reason: decision.reason },
              'Backpressure throttling task processing',
            );
            return;
          }
        }

        // Get highest priority task (from priority scheduler if available)
        let taskId: string | null = null;

        if (this.priorityScheduler) {
          const batch = await this.priorityScheduler.getNextBatch(1);
          if (batch.length > 0) {
            taskId = batch[0].id;
          }
        } else {
          // Fallback to legacy queue
          const taskIds = await this.redis.zrevrange(this.queueKey, 0, 0);
          taskId = taskIds[0] || null;
        }

        if (!taskId) {
          span.setAttribute('scheduler.queue_empty', true);
          return;
        }

        span.setAttribute('task.id', taskId);

        // Get task from database
        const task = await this.prisma.task.findUnique({ where: { id: taskId } });

        if (!task || task.status !== 'PENDING') {
          // Remove from queue if not pending
          await this.redis.zrem(this.queueKey, taskId);
          span.setAttribute('task.invalid_status', task?.status || 'NOT_FOUND');
          return;
        }

        // Check rate limiting
        if (this.schedulerRateLimiter) {
          const userId = (task as any).userId || 'system';
          const rateLimitCheck = await this.schedulerRateLimiter.checkRateLimit(
            taskId,
            userId,
            'pending',
          );
          if (!rateLimitCheck.allowed) {
            span.setAttribute('scheduler.rate_limited', true);
            this.logger.debug(
              { taskId, reason: rateLimitCheck.reason },
              'Rate limit exceeded, deferring task',
            );
            return;
          }
        }

        // Find suitable node
        const node = await this.findNode(task);

        if (!node) {
          span.setAttribute('scheduler.no_node_found', true);
          this.logger.debug(
            { taskId },
            'No suitable node found, task remains in queue',
          );
          return;
        }

        span.setAttribute('node.id', node.id);

        // Check circuit breaker
        if (await this.isCircuitOpen(node.id)) {
          span.setAttribute('node.circuit_open', true);
          this.logger.debug(
            { taskId, nodeId: node.id },
            'Circuit breaker open, skipping node',
          );
          return;
        }

        // Remove from queue
        await this.redis.zrem(this.queueKey, taskId);

        // Record rate limit usage
        if (this.schedulerRateLimiter) {
          const userId = (task as any).userId || 'system';
          await this.schedulerRateLimiter.recordTaskScheduled(userId, node.id);
        }

        // Assign task to node
        await this.assignTask(task, node as any, (node as any).mlResult);
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        this.logger.error({ error }, 'Error processing task queue');
      } finally {
        span.end();
      }
    });
  }

  private async getSystemMetrics() {
    if (this.backpressureController) {
      return this.backpressureController.getSystemMetrics();
    }
    
    // Fallback if controller not available
    return {
      queueDepth: await this.redis.zcard(this.queueKey),
      concurrentTasks: parseInt((await this.redis.get('tasks:running')) || '0', 10),
      avgNodeLoad: 0,
      memoryUsage: 0,
      cpuUsage: 0,
    };
  }

  private async findNode(
    task: Task,
  ): Promise<{ id: string; url: string; mlResult?: any } | null> {
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
    });

    if (nodes.length === 0) {
      return null;
    }

    const circuitStates = await Promise.all(
      nodes.map(async (n: { id: string }) => ({
        id: n.id,
        isOpen: await this.isCircuitOpen(n.id),
      })),
    );
    const openCircuits = new Set(
      circuitStates.filter((s: { isOpen: boolean }) => s.isOpen).map((s: { id: string }) => s.id),
    );
    const availableNodes = nodes.filter(
      (n: { id: string }) => !openCircuits.has(n.id),
    );
    if (availableNodes.length === 0) {
      this.logger.warn('All nodes have open circuit breakers');
      return null;
    }

    // 1. Mandatory Fallback / Policy check
    if (task.policy === 'ml-optimized') {
      const selectedResult = await this.mlScheduler.schedule(task as any, availableNodes as any, this.schedulerWeights);
      if (selectedResult) {
        const node = availableNodes.find(n => n.id === selectedResult.decision.nodeId);
        return node ? { id: node.id, url: node.url, mlResult: selectedResult } : null;
      }
    }

    // Default delegation to shared-kernel selectNode for other policies
    const selected = await selectNode(availableNodes as any, task as any, {
      weights: this.schedulerWeights,
      policy: task.policy,
    });

    return selected ? { id: selected.id, url: (selected as any).url } : null;
  }

  private async runRetentionCleanup() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const deleted = await (this.prisma as any).schedulingDecision.deleteMany({
        where: {
          timestamp: { lt: thirtyDaysAgo }
        }
      });
      
      this.logger.info({ count: deleted.count }, 'Cleaned up old scheduling decisions');
    } catch (error) {
      this.logger.error({ error }, 'Failed to run scheduling decision retention cleanup');
    }
  }

  /**
   * Records the outcome of a task for drift detection and metrics
   */
  async recordTaskOutcome(taskId: string, durationMs: number, status: 'COMPLETED' | 'FAILED') {
    try {
      const task = await this.prisma.task.findUnique({
        where: { id: taskId },
        select: { id: true, policy: true, metadata: true, nodeId: true }
      });

      if (!task || task.policy !== 'ml-optimized') return;

      const metadata = task.metadata as any;
      if (!metadata?.predictedScore || !metadata?.modelVersion) return;

      // Calculate actual score (on-time = 1.0, late = 0.5, failed = 0.0)
      let actualScore = 0;
      if (status === 'COMPLETED') {
        const threshold = 5000; // 5 seconds threshold for on-time
        actualScore = durationMs < threshold ? 1.0 : 0.5;
      }

      this.driftDetector.recordOutcome({
        taskId,
        predictedScore: metadata.predictedScore,
        actualScore,
        modelVersion: metadata.modelVersion,
        nodeId: task.nodeId || 'unknown',
        timestamp: new Date()
      });

      this.logger.debug({ taskId, predicted: metadata.predictedScore, actual: actualScore }, 'Task outcome recorded for ML drift detection');
    } catch (error) {
      this.logger.error({ taskId, error }, 'Failed to record task outcome for ML');
    }
  }

  /**
   * Update scheduler weights (via API)
   */
  setSchedulerWeights(weights: Partial<ScoreWeights>): void {
    this.schedulerWeights = { ...this.schedulerWeights, ...weights };
    this.logger.info(
      { weights: this.schedulerWeights },
      'Updated scheduler weights',
    );
  }

  /**
   * Get current scheduler weights
   */
  getSchedulerWeights(): ScoreWeights {
    return { ...this.schedulerWeights };
  }

  private async assignTask(task: Task, node: { id: string; url: string }, mlResult?: any) {
    this.logger.info(
      { taskId: task.id, nodeId: node.id, hasML: !!mlResult },
      'Assigning task to node',
    );

    // Persist scheduling decision
    try {
      await (this.prisma as any).schedulingDecision.upsert({
        where: { taskId: task.id },
        update: {
          selectedNodeId: node.id,
          policy: task.policy,
          score: mlResult?.decision.score || 1.0,
          explanation: mlResult?.explanation || { top_features: [] },
          candidateNodes: mlResult?.candidateNodes || [],
          mlModelVersion: mlResult?.modelVersion || null,
          fallbackUsed: mlResult?.fallbackUsed || false,
        },
        create: {
          taskId: task.id,
          selectedNodeId: node.id,
          policy: task.policy,
          score: mlResult?.decision.score || 1.0,
          explanation: mlResult?.explanation || { top_features: [] },
          candidateNodes: mlResult?.candidateNodes || [],
          mlModelVersion: mlResult?.modelVersion || null,
          fallbackUsed: mlResult?.fallbackUsed || false,
        }
      });

      // Record in system audit log
      await this.prisma.auditLog.create({
        data: {
          action: 'SCHEDULE_TASK',
          entityType: 'Task',
          entityId: task.id,
          details: {
            nodeId: node.id,
            policy: task.policy,
            actor: 'system:ml-scheduler',
            fallbackUsed: mlResult?.fallbackUsed || false
          }
        }
      });
    } catch (err) {
      this.logger.error({ taskId: task.id, err }, 'Failed to persist scheduling decision or audit log');
    }

    // Update task status
    await this.prisma.task.update({
      where: { id: task.id },
      data: {
        nodeId: node.id,
        status: 'SCHEDULED',
        reason: `Scheduled on node ${node.id}`,
      },
    });

    // Send to edge agent with circuit breaker protection
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const requestId = getRequestId() || `${task.id}-${Date.now()}`;
      const traceId = getTraceId() || requestId;

      // Get or create circuit breaker for this node
      const breaker = this.circuitBreakerRegistry.getOrCreate(node.id, {
        failureThreshold: CIRCUIT_BREAKER_THRESHOLD,
        resetTimeout: CIRCUIT_BREAKER_RESET_TIME,
        name: node.id,
      });

      // Execute HTTP call with circuit breaker protection
      await breaker.execute(async () => {
        await tracer.startActiveSpan('scheduler:dispatch_task', {
          kind: SpanKind.CLIENT,
          attributes: {
            'http.method': 'POST',
            'http.url': `${node.url}/run-task`,
            'task.id': task.id,
            'node.id': node.id,
          }
        }, async (span) => {
          try {
            await axios.post(
              `${node.url}/run-task`,
              {
                taskId: task.id,
                taskName: task.name,
                type: task.type,
                input: task.input,
                timeout: TASK_TIMEOUT,
              },
              {
                timeout: REQUEST_TIMEOUT,
                signal: controller.signal,
                headers: {
                  'X-Request-ID': requestId,
                  'X-Trace-ID': traceId,
                  'X-Source': 'task-scheduler',
                },
              },
            );
            span.setStatus({ code: SpanStatusCode.OK });
          } catch (err: any) {
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw err;
          } finally {
            span.end();
          }
        });
      });

      clearTimeout(timeoutId);

      // Clear distributed state on success
      await this.redis.del(`circuit:${node.id}:state`);

      // Mark as running
      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          status: 'RUNNING',
        },
      });

      // Update node task count
      await this.prisma.edgeNode.update({
        where: { id: node.id },
        data: { tasksRunning: { increment: 1 } },
      });

      this.wsManager.broadcast('task:started', {
        taskId: task.id,
        nodeId: node.id,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Circuit breaker automatically records failure
      // Sync to Redis if circuit is now open
      const breaker = this.circuitBreakerRegistry.get(node.id);
      if (breaker?.getState() === 'OPEN') {
        await this.redis.setex(`circuit:${node.id}:state`, 60, 'OPEN');
      }

      const errorMessage = axios.isAxiosError(error)
        ? `HTTP ${error.response?.status}: ${error.message}`
        : (error as Error).message;

      this.logger.error({ 
        taskId: task.id, 
        error: errorMessage, 
        predictor: !!this.mlScheduler,
        graceful: !!this._gracefulDegradation 
      }, 'Task execution failed');

      // Mark as failed and potentially retry
      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
        },
      });

      // Re-enqueue if retries available
      const executionCount = await this.prisma.taskExecution.count({
        where: { taskId: task.id },
      });
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
            metadata: { ...(task.metadata as object), retryOf: task.id },
            maxRetries: task.maxRetries,
          } as any,
        });

        // Enqueue retry task
        await this.enqueue(retryTask as any);
      }
    }
  }

  async handleTaskCompletion(
    taskId: string,
    nodeId: string,
    result: {
      status: 'completed' | 'failed';
      output?: unknown;
      error?: string;
      duration: number;
    },
  ) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });

    if (!task) {
      this.logger.warn({ taskId }, 'Task not found for completion');
      return;
    }

    // Record success for circuit breaker
    await this.recordSuccess(nodeId);

    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: result.status === 'completed' ? 'COMPLETED' : 'FAILED',
      },
    });

    // Update node task count (with check to prevent negative)
    const node = await this.prisma.edgeNode.findUnique({
      where: { id: nodeId },
      select: { tasksRunning: true },
    });

    if (node && node.tasksRunning > 0) {
      await this.prisma.edgeNode.update({
        where: { id: nodeId },
        data: { tasksRunning: { decrement: 1 } },
      });
    }

    this.wsManager.broadcast(`task:${result.status}`, {
      taskId,
      nodeId,
      duration: result.duration,
      timestamp: new Date().toISOString(),
    });
  }

  getQueueLength(): Promise<number> {
    return this.redis.zcard(this.queueKey);
  }

  async getQueuePosition(taskId: string): Promise<number> {
    const rank = await this.redis.zrevrank(this.queueKey, taskId);
    return rank !== null ? rank + 1 : -1;
  }
}
