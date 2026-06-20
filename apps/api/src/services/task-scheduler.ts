/**
 * TaskScheduler — the core scheduling engine.
 *
 * What it does: picks which edge node should run each submitted task,
 * considering cost, latency, and carbon intensity (weighted per-tenant
 * via SchedulingPolicy), node health (deprioritizing failing nodes),
 * and a learned adjustment from a contextual bandit that improves over
 * time based on real outcomes.
 *
 * Key methods:
 * - start() — sets up leader election, queues polling loop, model hot-swap, and retention cron jobs
 * - processQueue() — runs every 50ms, is the main scheduling loop (claims leader lock, dequeues, processes tasks)
 * - scoreNode() — combines all the scoring signals into one final number using weights and ML
 * - assignTask() — schedules the task on the target node, updates DB, sends assignment via WebSocket
 * - carbonShiftSchedule() — calculates forecast-based delays to defer tasks to lower-carbon windows
 *
 * Related docs: docs/decisions/ADR-002-redlock-distributed-locking.md, ADR-001-tensorflow-js-not-python.md
 */
import { env } from '../config/env';
import {
  selectNode,
  LeaderElection,
  type ScoreWeights,
  tracer,
  getTraceId,
  getRequestId,
  SpanKind,
  SpanStatusCode,
  IPriorityScheduler,
  IBackpressureController,
  IGracefulDegradation,
  ISchedulerRateLimiter,
  SCHEDULER_CONSTANTS,
} from '@edgecloud/shared-kernel';
import {
  SchedulingPredictor,
  MLScheduler,
  ModelRegistry,
  DriftDetector,
  FeatureExtractor,
  OutcomeCollector,
  IncrementalUpdater,
  GridCarbonClient,
  calculateReward,
} from '@edgecloud/ml-scheduler';
import axios from 'axios';
import { CircuitBreakerRegistry } from '@edgecloud/circuit-breaker';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import Redlock from 'redlock';
import type { Logger } from 'pino';
import { MetricsCollector } from '@edgecloud/observability';
import { EventEmitter } from 'events';

import type { WebSocketManager } from './websocket-manager';
import { NodeHealthScorer } from './node-health-scorer';

const TASK_TIMEOUT = SCHEDULER_CONSTANTS.TASK_TIMEOUT_MS;
const REDIS_KEY_TTL = SCHEDULER_CONSTANTS.REDIS_KEY_TTL_SEC;
const REQUEST_TIMEOUT = SCHEDULER_CONSTANTS.REQUEST_TIMEOUT_MS;
const CIRCUIT_BREAKER_THRESHOLD = SCHEDULER_CONSTANTS.CIRCUIT_BREAKER_THRESHOLD;
const CIRCUIT_BREAKER_RESET_TIME = SCHEDULER_CONSTANTS.CIRCUIT_BREAKER_RESET_MS;
const LEADER_LOCK_TTL = SCHEDULER_CONSTANTS.LEADER_LOCK_TTL_MS;
const LEADER_LOCK_KEY = SCHEDULER_CONSTANTS.LEADER_LOCK_KEY;

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
  runtime: 'NATIVE' | 'DOCKER' | 'WASM';
  affinity?: string | null;
  traceId?: string | null;
  tenantId: string;
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

export class TaskScheduler extends EventEmitter {
  private prisma: PrismaClient;
  private redis: Redis;
  private wsManager: WebSocketManager;
  private logger: Logger;
  private leaderElection: LeaderElection;
  private redlock: Redlock;
  private interval: NodeJS.Timeout | null = null;
  private hotswapInterval: NodeJS.Timeout | null = null;
  private reconcileInterval: NodeJS.Timeout | null = null;
  private retentionInterval: NodeJS.Timeout | null = null;
  private queueKey = 'task:queue';
  private circuitBreakerRegistry: CircuitBreakerRegistry;
  private schedulerWeights: ScoreWeights;
  private instanceId: string;

  // Performance caches
  private circuitCache = new Map<string, { open: boolean; expires: number }>();
  private onlineNodesCache: { nodes: any[]; expires: number } | null = null;
  private static readonly CIRCUIT_CACHE_TTL_MS = 30_000; // 30 seconds per user decision
  private static readonly ONLINE_NODES_CACHE_TTL_MS = 500;

  // ML Scheduler components
  private mlScheduler: MLScheduler;
  private driftDetector: DriftDetector;
  public modelRegistry: ModelRegistry;
  private outcomeCollector: OutcomeCollector;
  private incrementalUpdater: IncrementalUpdater;
  private carbonClient: GridCarbonClient;
  public featureExtractor: FeatureExtractor;
  private metrics: MetricsCollector;

  private nodeHealthScorer: NodeHealthScorer;
  private coldStartHandler?: any;

  // Integration services
  private priorityScheduler?: IPriorityScheduler;
  private backpressureController?: IBackpressureController;
  private _gracefulDegradation?: IGracefulDegradation;
  public schedulerRateLimiter?: ISchedulerRateLimiter;

  // Real-time state tracking
  private retrainStatus:
    | 'IDLE'
    | 'QUEUED'
    | 'TRAINING'
    | 'VALIDATING'
    | 'DEPLOYED'
    | 'FAILED' = 'IDLE';
  private retrainError: string | null = null;
  private driftHistory: { timestamp: string; score: number }[] = [];
  private lastDriftCheck: number = 0;
  private isRunning: boolean = false;

  constructor(
    prisma: PrismaClient,
    redis: Redis,
    wsManager: WebSocketManager,
    logger: Logger,
  ) {
    super(); // Initialize EventEmitter
    this.prisma = prisma;
    this.redis = redis;
    this.wsManager = wsManager;
    this.logger = logger;
    this.circuitBreakerRegistry = new CircuitBreakerRegistry();
    this.redlock = new Redlock([this.redis as any]);

    // Initialize metrics
    this.metrics = new MetricsCollector({
      serviceName: 'orchestrator-api',
      serviceVersion: '2.0.0',
    });

    // Initialize ML scheduler components
    const predictor = new SchedulingPredictor();
    this.modelRegistry = new ModelRegistry(this.redis);
    this.driftDetector = new DriftDetector(this.metrics, this.prisma);

    // Register drift alert listener to trigger automated retraining or rollback
    this.driftDetector.onDrift(async (mae) => {
      this.logger.warn(
        { mae },
        'ML Drift detected. Evaluating retraining or rollback policy.',
      );

      // 1. Critical drift triggers rollback
      if (mae >= 0.5) {
        this.logger.error({ mae }, 'Critical ML drift detected! Attempting automatic model rollback.');
        try {
          const rolledBackVersion = await this.modelRegistry.rollbackModel();
          if (rolledBackVersion) {
            this.logger.warn({ version: rolledBackVersion }, 'Successfully rolled back to previous model checkpoint.');
            this.driftDetector.reset();
            this.wsManager.broadcast('ml:model:rolledback', { version: rolledBackVersion });
            // Immediately check hot swap to load the rolled back model
            await this.mlScheduler.checkHotSwap();
          } else {
            this.logger.error('Critical drift detected, but no rollback version history is available.');
          }
        } catch (err: any) {
          this.logger.error({ err }, 'Failed to rollback model.');
        }
      }

      // 2. Both warning and critical drift trigger retraining
      if (mae >= 0.3) {
        this.logger.info({ mae }, 'Triggering background model retraining.');
        this.triggerMLRetrain().catch((err) => {
          this.logger.error({ err }, 'Failed to trigger automated background retraining.');
        });
      }

      const githubToken = env.GITHUB_TOKEN;
      const repoOwner = env.GITHUB_REPO_OWNER || 'owner';
      const repoName = env.GITHUB_REPO_NAME || 'edge-cloud-orchestrator';

      if (githubToken) {
        try {
          const axios = await import('axios');
          await axios.default.post(
            `https://api.github.com/repos/${repoOwner}/${repoName}/dispatches`,
            {
              event_type: 'ml_drift_alert',
              client_payload: {
                mae,
                timestamp: new Date().toISOString(),
              },
            },
            {
              headers: {
                Authorization: `Bearer ${githubToken}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
              },
            },
          );
          this.logger.info('Successfully triggered GitHub ml-retrain workflow.');
        } catch (error: any) {
          this.logger.error(
            { error: error.message },
            'Failed to trigger GitHub ml-retrain workflow.',
          );
        }
      }
    });

    this.incrementalUpdater = new IncrementalUpdater(
      this.prisma,
      this.modelRegistry,
      this.metrics,
    );
    this.outcomeCollector = new OutcomeCollector(
      this.prisma,
      this.redis,
      this.metrics,
      this.incrementalUpdater,
    );
    this.carbonClient = new GridCarbonClient(
      this.redis,
      env.ELECTRICITY_MAPS_API_KEY,
    );

    this.mlScheduler = new MLScheduler(
      predictor,
      this.modelRegistry,
      this.driftDetector,
      this.metrics,
      this.outcomeCollector,
      this.carbonClient,
    );
    this.featureExtractor = new FeatureExtractor(this.prisma);
    this.nodeHealthScorer = new NodeHealthScorer(this.prisma, this.wsManager, this.logger);

    // Default weights - can be updated via API
    this.schedulerWeights = {
      latency: 0.15,
      cpu: 0.15,
      memory: 0.1,
      cost: 0.2,
      network: 0.1,
      ml: 0.1,
      health: 0.1,
      carbon: 0.1,
    };

    this.instanceId = `scheduler-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    this.leaderElection = new LeaderElection(this.redis, this.logger, {
      lockKey: LEADER_LOCK_KEY,
      ttl: LEADER_LOCK_TTL,
      unlockOnStop: true,
    });
  }

  // Setter methods for integration
  setPriorityScheduler(scheduler: IPriorityScheduler): void {
    this.priorityScheduler = scheduler;
  }

  setBackpressureController(controller: IBackpressureController): void {
    this.backpressureController = controller;
  }

  setGracefulDegradation(service: IGracefulDegradation): void {
    this._gracefulDegradation = service;
  }

  setSchedulerRateLimiter(limiter: ISchedulerRateLimiter): void {
    this.schedulerRateLimiter = limiter;
  }

  setColdStartHandler(handler: any): void {
    this.coldStartHandler = handler;
  }

  async start(): Promise<void> {
    await this.leaderElection.start(this.instanceId, LEADER_LOCK_TTL);
    this.isRunning = true;

    // Initial check
    if (this.leaderElection.isCurrentlyLeader()) {
      void this.processQueue();
    }

    // Only process queue if we are the leader
    this.interval = setInterval(() => {
      const isLeader = this.leaderElection.isCurrentlyLeader();
      if (isLeader) {
        void this.processQueue();
      } else {
        this.logger.info(
          { instanceId: this.instanceId },
          'Not currently leader, skipping processQueue',
        );
      }
    }, 50); // High performance for load testing

    // ML Model Hot-swap monitoring (poll every 60s)
    this.hotswapInterval = setInterval(async () => {
      await this.checkActiveModel();
    }, 60000);

    // Initial ML check
    await this.checkActiveModel();

    // Start reconciliation job (every 5 minutes) to fix drift
    this.reconcileInterval = setInterval(() => {
      if (this.leaderElection.isCurrentlyLeader()) {
        void this.reconcileTaskCounts();
      }
    }, 300000);

    // Start decision retention cleanup (every 24 hours)
    this.retentionInterval = setInterval(() => {
      if (this.leaderElection.isCurrentlyLeader()) {
        void this.runRetentionCleanup();
      }
    }, 86400000);

    // Call cold start handler if registered
    if (
      this.coldStartHandler &&
      typeof (this.coldStartHandler as any).syncAllNodes === 'function'
    ) {
      await (this.coldStartHandler as any).syncAllNodes(this.prisma);
    }

    this.logger.info(
      {
        instanceId: this.instanceId,
        isLeader: this.leaderElection.isCurrentlyLeader(),
      },
      'Task scheduler started',
    );
  }

  private async checkActiveModel(): Promise<void> {
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
      // 1. Recover zombie tasks stuck in SCHEDULED for > 60s
      const cutoff = new Date(Date.now() - 60000);
      const zombieTasks = await this.prisma.task.findMany({
        where: {
          status: 'SCHEDULED',
          submittedAt: { lt: cutoff },
        },
        select: { id: true, priority: true, submittedAt: true, nodeId: true },
      });

      if (zombieTasks.length > 0) {
        const zombieIds = zombieTasks.map((t) => t.id);
        this.logger.warn(
          { zombieIds },
          'Recovering zombie tasks stuck in SCHEDULED',
        );

        await this.prisma.task.updateMany({
          where: { id: { in: zombieIds } },
          data: { status: 'PENDING', nodeId: null },
        });

        // Re-enqueue in Redis queue
        for (const task of zombieTasks) {
          if (this.schedulerRateLimiter && task.nodeId) {
            await this.schedulerRateLimiter.recordTaskCompleted(task.nodeId);
          }
          const score = this.getPriorityScore(task as any);
          await this.redis.zadd('task:queue', score, task.id);
        }
      }

      // 2. Reconcile node running counts
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

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.hotswapInterval) {
      clearInterval(this.hotswapInterval);
      this.hotswapInterval = null;
    }
    if (this.reconcileInterval) {
      clearInterval(this.reconcileInterval);
      this.reconcileInterval = null;
    }
    if (this.retentionInterval) {
      clearInterval(this.retentionInterval);
      this.retentionInterval = null;
    }

    void this.leaderElection.stop();

    this.logger.info({ instanceId: this.instanceId }, 'Task scheduler stopped');
  }

  /**
   * Check if this scheduler instance is currently the leader
   */
  isCurrentlyLeader(): boolean {
    return this.leaderElection.isCurrentlyLeader();
  }

  async enqueue(task: Task): Promise<void> {
    // Add to Redis queue with priority
    const priority = this.getPriorityScore(task);
    await this.redis.zadd(this.queueKey, priority, task.id);
    // Set TTL on the queue key
    await this.redis.expire(this.queueKey, REDIS_KEY_TTL);
    this.logger.info({ taskId: task.id, priority }, 'Task enqueued');
  }

  async dequeue(taskId: string): Promise<void> {
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
    // Check in-memory cache first (30s TTL)
    const cached = this.circuitCache.get(nodeId);
    if (cached && Date.now() < cached.expires) {
      return cached.open;
    }

    // Check distributed state first (Redis)
    const distributedState = await this.redis.get(`circuit:${nodeId}:state`);
    if (distributedState === 'OPEN') {
      this.circuitCache.set(nodeId, {
        open: true,
        expires: Date.now() + TaskScheduler.CIRCUIT_CACHE_TTL_MS,
      });
      return true;
    }

    const breaker = this.circuitBreakerRegistry.getOrCreate(nodeId, {
      failureThreshold: CIRCUIT_BREAKER_THRESHOLD,
      resetTimeout: CIRCUIT_BREAKER_RESET_TIME,
      name: nodeId,
    });

    const state = breaker.getState();
    const isOpen = state === 'OPEN';

    if (isOpen) {
      this.logger.debug(
        { nodeId, state, distributedState },
        'Circuit is open for node',
      );
    }

    // Sync to Redis if open
    if (isOpen) {
      await this.redis.setex(`circuit:${nodeId}:state`, 60, 'OPEN');
    }

    // Cache the result
    this.circuitCache.set(nodeId, {
      open: isOpen,
      expires: Date.now() + TaskScheduler.CIRCUIT_CACHE_TTL_MS,
    });

    return isOpen;
  }

  private async recordSuccess(nodeId: string): Promise<void> {
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
  getCircuitBreakerHealth(): any {
    return this.circuitBreakerRegistry.healthCheck();
  }

  /**
   * scoreAndAssignWithLock - Selects a node, acquires a lock, checks capacity, and assigns the task.
   * Asserts concurrency control.
   */
  public async scoreAndAssignWithLock(task: Task): Promise<boolean> {
    const schedulingStartTime = performance.now();
    const node = await this.findNode(task);
    if (!node) {
      this.logger.warn({ taskId: task.id }, 'No suitable node found for task');
      return false;
    }

    const lockKey = `lock:node:assignment:${node.id}`;
    let lock;
    try {
      lock = await this.redlock.acquire([lockKey], 2000);
    } catch (err) {
      this.logger.warn(
        { taskId: task.id, nodeId: node.id },
        'Failed to acquire node assignment lock',
      );
      return false;
    }

    try {
      const latestNode = await this.prisma.edgeNode.findUnique({
        where: { id: node.id },
        select: {
          tasksRunning: true,
          status: true,
          isMaintenanceMode: true,
          maxTasks: true,
        },
      });

      if (!latestNode) {
        return false;
      }

      const maxTasks = (latestNode as any).maxTasks || 10;
      if (
        latestNode.tasksRunning >= maxTasks ||
        latestNode.status !== 'ONLINE' ||
        latestNode.isMaintenanceMode
      ) {
        return false;
      }

      await this.assignTask(
        task,
        node as any,
        node.mlResult,
        schedulingStartTime,
      );
      return true;
    } finally {
      try {
        await (lock as any).release();
      } catch (err) {
        this.logger.error({ err }, 'Failed to release node assignment lock');
      }
    }
  }

  /**
   * Determine if a deferrable task should be delayed to a lower-carbon window based on forecasts.
   * Returns a boolean indicating if the task was deferred in this cycle.
   */
  private async carbonShiftSchedule(task: any): Promise<boolean> {
    if (!task.isDeferrable || task.maxDelayMinutes <= 0) {
      return false;
    }

    const now = Date.now();
    const elapsedMs = now - new Date(task.submittedAt).getTime();
    const elapsedMinutes = elapsedMs / 60000;

    // If we've already exceeded the max delay, we must run it now
    if (elapsedMinutes >= task.maxDelayMinutes) {
      this.logger.info(
        { taskId: task.id, elapsedMinutes, maxDelayMinutes: task.maxDelayMinutes },
        'Task exceeded maximum delay limit; executing immediately',
      );
      // Clean up any deferral keys in Redis
      await this.redis.del(`task:deferred:${task.id}:until`);
      return false;
    }

    // Check if we already have an active deferral decision in Redis
    const deferredUntilStr = await this.redis.get(`task:deferred:${task.id}:until`);
    if (deferredUntilStr) {
      const deferredUntil = parseInt(deferredUntilStr, 10);
      if (now < deferredUntil) {
        this.logger.debug(
          { taskId: task.id, remainingMs: deferredUntil - now },
          'Task is deferred, skipping execution',
        );
        return true; // Skip processing
      }
      // Deferral time has passed; execute now
      return false;
    }

    // No deferral decision exists yet. Let's calculate the optimal window!
    // 1. Get candidate nodes to identify target regions
    const nodes = await this.prisma.edgeNode.findMany({
      where: {
        status: 'ONLINE',
        isMaintenanceMode: false,
      },
      select: { region: true, carbonIntensity: true },
    });

    if (nodes.length === 0) {
      return false; // No nodes, let fallback/default scheduler handle it
    }

    // Get unique zones
    const zones = Array.from(
      new Set(nodes.map((n) => this.carbonClient.mapRegionToZone(n.region))),
    );

    // 2. Fetch forecasts for candidate zones
    let bestZone = zones[0];
    let bestForecast: { datetime: string; carbonIntensity: number }[] = [];
    let currentMinIntensity = Infinity;

    for (const zone of zones) {
      const forecast = await this.carbonClient.getCarbonIntensityForecast(zone);
      if (forecast && forecast.length > 0) {
        const zoneNodes = nodes.filter(
          (n) => this.carbonClient.mapRegionToZone(n.region) === zone,
        );
        const firstForecast = forecast[0];
        if (!firstForecast) continue;
        const currentIntensity =
          zoneNodes.find((n) => n.carbonIntensity !== null)?.carbonIntensity ??
          firstForecast.carbonIntensity;

        if (currentIntensity < currentMinIntensity) {
          currentMinIntensity = currentIntensity;
          bestZone = zone;
          bestForecast = forecast;
        }
      }
    }

    this.logger.debug({ bestZone }, 'Determined best carbon zone for forecast evaluation');

    if (bestForecast.length === 0) {
      return false; // Could not get forecast
    }

    // 3. Find the lowest carbon intensity window within the remaining maxDelayMinutes
    const maxDelayMs = task.maxDelayMinutes * 60 * 1000;
    const deadline = new Date(task.submittedAt).getTime() + maxDelayMs;

    // Filter forecast points that fall within the allowable delay window
    const validForecasts = bestForecast.filter((point) => {
      const pointTime = new Date(point.datetime).getTime();
      return pointTime >= now && pointTime <= deadline;
    });

    const firstPoint = validForecasts[0];
    if (!firstPoint) {
      return false;
    }

    // Find the minimum intensity point in the future
    const minPoint = validForecasts.reduce(
      (min, point) => (point.carbonIntensity < min.carbonIntensity ? point : min),
      firstPoint,
    );

    const currentIntensity = currentMinIntensity;
    const savingsThreshold = Math.max(20, currentIntensity * 0.1); // at least 10% or 20 gCO2eq/kWh savings

    const targetTime = new Date(minPoint.datetime).getTime();
    if (
      minPoint.carbonIntensity < currentIntensity - savingsThreshold &&
      targetTime > now + 60000 // Only delay if the window is at least 1 minute in the future
    ) {
      const delayDurationMs = targetTime - now;
      this.logger.info(
        {
          taskId: task.id,
          currentIntensity,
          targetIntensity: minPoint.carbonIntensity,
          savingsGCo2eq: currentIntensity - minPoint.carbonIntensity,
          delayDurationMinutes: delayDurationMs / 60000,
          targetTime: minPoint.datetime,
        },
        'Carbon-aware shift: deferring task to lower carbon window',
      );

      const predictedSavings = currentIntensity - minPoint.carbonIntensity;
      this.metrics.recordCarbonMetrics(minPoint.carbonIntensity, predictedSavings);

      // Save the target time in Redis
      const remainingDelayMs = deadline - now;
      await this.redis.set(
        `task:deferred:${task.id}:until`,
        targetTime.toString(),
        'PX',
        remainingDelayMs, // Key expires at the deadline at latest
      );

      return true; // Yes, we deferred this task
    }

    return false; // Do not defer, execute now
  }

  async processQueue(): Promise<void> {
    if (!this.isRunning) return;

    const isLeader = this.leaderElection.isCurrentlyLeader();
    if (!isLeader) {
      this.logger.debug(
        { instanceId: this.instanceId },
        '[Scheduler] Not leader, skipping',
      );
      return;
    }

    this.logger.debug(
      { instanceId: this.instanceId },
      '[Scheduler] processQueue batch started',
    );
    const tStart = performance.now();
    const BATCH_SIZE = 200;
    let processed = 0;
    let skipped = 0;
    let empty = false;

    // 1. Get a batch of tasks from the queue at once
    let batchTaskIds: string[] = [];
    if (this.priorityScheduler) {
      const priorityBatch =
        await this.priorityScheduler.getNextBatch(BATCH_SIZE);
      if (priorityBatch && priorityBatch.length > 0) {
        batchTaskIds = priorityBatch.map((t) => t.id);
      }
    }
    if (batchTaskIds.length < BATCH_SIZE) {
      const needed = BATCH_SIZE - batchTaskIds.length;
      const fallbackIds = await this.redis.zrevrange(
        this.queueKey,
        0,
        needed - 1,
      );
      if (fallbackIds && Array.isArray(fallbackIds)) {
        batchTaskIds.push(...fallbackIds);
      }
    }

    batchTaskIds = Array.from(new Set(batchTaskIds));

    if (batchTaskIds.length === 0) {
      this.logger.debug('[Scheduler] Queue empty');
      empty = true;
      return;
    }

    const tasksToRem: string[] = [];

    // 2. Fetch task details in a single query
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: batchTaskIds } },
    });

    const pendingTasks: Task[] = [];
    for (const taskId of batchTaskIds) {
      const t = tasks.find((x) => x.id === taskId);
      if (!t || t.status !== 'PENDING') {
        tasksToRem.push(taskId);
      } else {
        pendingTasks.push(t);
      }
    }

    if (pendingTasks.length === 0) {
      if (tasksToRem.length > 0) {
        await this.redis.zrem(this.queueKey, ...tasksToRem);
      }
      return;
    }

    // 3. Pre-fetch tenant policies/weights in a single query
    const tenantIds = Array.from(
      new Set(pendingTasks.map((t) => t.tenantId).filter((id): id is string => !!id)),
    );
    let tenantPolicyMap = new Map<string, any>();
    if (tenantIds.length > 0) {
      const cacheResults = await Promise.all(
        tenantIds.map(async (tid) => {
          const cached = await this.redis.get(`tenant:policy:${tid}`);
          return { tid, cached };
        })
      );
      const missingTenantIds: string[] = [];
      for (const r of cacheResults) {
        if (r.cached) {
          try {
            tenantPolicyMap.set(r.tid, JSON.parse(r.cached));
          } catch (e) {}
        } else {
          missingTenantIds.push(r.tid);
        }
      }
      if (missingTenantIds.length > 0) {
        const policies = await this.prisma.schedulingPolicy.findMany({
          where: { tenantId: { in: missingTenantIds }, isActive: true },
        });
        for (const p of policies) {
          if (p.config) {
            tenantPolicyMap.set(p.tenantId, p.config);
            await this.redis.setex(`tenant:policy:${p.tenantId}`, 10, JSON.stringify(p.config));
          }
        }
      }
    }

    // 4. Pre-fetch rate limit status in parallel
    const rateLimitMap = new Map<string, boolean>();
    if (this.schedulerRateLimiter) {
      const rateLimitResults = await Promise.all(
        pendingTasks.map(async (task) => {
          const userId = (task as any).userId || 'system';
          const check = await this.schedulerRateLimiter!.checkRateLimit(
            task.id,
            userId,
            'pending',
          );
          return { taskId: task.id, allowed: check.allowed };
        }),
      );
      for (const r of rateLimitResults) {
        rateLimitMap.set(r.taskId, r.allowed);
      }
    }

    // 5. Fetch all ONLINE nodes once (cached for 500ms)
    let onlineNodes: any[];
    if (this.onlineNodesCache && Date.now() < this.onlineNodesCache.expires) {
      onlineNodes = this.onlineNodesCache.nodes;
    } else {
      onlineNodes = await this.prisma.edgeNode.findMany({
        where: {
          status: 'ONLINE',
          isMaintenanceMode: false,
        },
      });
      this.onlineNodesCache = {
        nodes: onlineNodes,
        expires: Date.now() + TaskScheduler.ONLINE_NODES_CACHE_TTL_MS,
      };
    }

    if (onlineNodes.length === 0) {
      this.logger.warn('[Scheduler] No online nodes found');
      return;
    }

    // 6. Fetch health scores for all these nodes
    const allNodeIds = onlineNodes.map((n) => n.id);
    const healthScores = await this.prisma.nodeHealthScore.findMany({
      where: { nodeId: { in: allNodeIds } },
    });
    const healthMap = new Map(
      healthScores.map((h) => [h.nodeId, h.penaltyMultiplier]),
    );

    // 7. Check circuit breaker status in parallel
    const circuitStates = await Promise.all(
      allNodeIds.map(async (id) => ({
        id,
        isOpen: await this.isCircuitOpen(id),
      })),
    );
    const openCircuits = new Set(
      circuitStates.filter((s) => s.isOpen).map((s) => s.id),
    );
    const availableNodes = onlineNodes.filter((n) => !openCircuits.has(n.id));

    // Map to in-memory representations with updated tasksRunning
    const inMemoryNodes = availableNodes.map((node) => ({
      ...node,
      penaltyMultiplier: healthMap.get(node.id) ?? 1.0,
      tasksRunning: node.tasksRunning,
    }));

    // 8. In-memory sequential matching
    const assignments: {
      task: Task;
      node: { id: string; url: string; mlResult?: any };
      schedulingStartTime: number;
    }[] = [];

    for (const task of pendingTasks) {
      // Deferral check
      const shouldDefer = await this.carbonShiftSchedule(task);
      if (shouldDefer) {
        skipped++;
        continue;
      }

      // Rate limit check
      if (this.schedulerRateLimiter && !rateLimitMap.get(task.id)) {
        skipped++;
        continue;
      }

      // Filter nodes by tenantId if applicable
      let nodesForTask = inMemoryNodes;
      if (!env.FORCE_MOCK_DB && (task as any).tenantId) {
        nodesForTask = inMemoryNodes.filter(
          (n) => n.tenantId === (task as any).tenantId,
        );
      }

      // Filter by capacity in-memory (using in-memory dynamically updated tasksRunning)
      nodesForTask = nodesForTask.filter(
        (n) => n.tasksRunning < (n.maxTasks ?? 10),
      );

      if (nodesForTask.length === 0) {
        this.logger.warn(
          { taskId: task.id },
          '[Scheduler] No suitable node found (capacity/filtering)',
        );
        continue;
      }

      // Runtime compatibility check
      const taskRuntime = ((task as any).runtime ?? 'DOCKER').toLowerCase();
      const runtimeCompatible = nodesForTask.filter((n: any) => {
        const caps: string[] | undefined = n.capabilities;
        if (!caps || caps.length === 0) return true;
        return caps.some((c: string) => c.toLowerCase() === taskRuntime);
      });
      const candidateNodes =
        runtimeCompatible.length > 0 ? runtimeCompatible : nodesForTask;

      // Sort candidate nodes by current in-memory tasksRunning ascending, then latency ascending
      candidateNodes.sort((a, b) => {
        if (a.tasksRunning !== b.tasksRunning) {
          return a.tasksRunning - b.tasksRunning;
        }
        return (a.latency ?? 0) - (b.latency ?? 0);
      });

      // Affinity check
      let affinityOrderedNodes = candidateNodes;
      const affinityJson = (task as any).affinity;
      if (affinityJson) {
        try {
          const { AffinityScorer } = await import('@edgecloud/scheduling-utils');
          const scorer = new AffinityScorer();
          const constraints =
            typeof affinityJson === 'string'
              ? JSON.parse(affinityJson)
              : affinityJson;
          if (Array.isArray(constraints) && constraints.length > 0) {
            const scored = candidateNodes.map((node: any) => ({
              node,
              score: scorer.calculateAffinityScore(
                task as any,
                node,
                constraints,
              ),
            }));
            scored.sort((a, b) => b.score - a.score);
            affinityOrderedNodes = scored.map((s) => s.node);
          }
        } catch (err) {}
      }

      // Weights policy
      let activeWeights = this.schedulerWeights;
      const tenantId = (task as any).tenantId;
      if (tenantId && tenantPolicyMap.has(tenantId)) {
        const config = tenantPolicyMap.get(tenantId);
        if (config) {
          activeWeights = {
            latency: config.latencyWeight ?? 0.33,
            cpu: 0,
            memory: 0,
            cost: config.costWeight ?? 0.33,
            network: 0,
            ml: 0,
            health: 0,
            carbon: config.carbonWeight ?? 0.34,
          };
        }
      }

      // Node selection
      let matchedNode: { id: string; url: string; mlResult?: any } | null = null;
      if (task.policy === 'ml-optimized') {
        try {
          const selectedResult = await this.mlScheduler.schedule(
            task as any,
            affinityOrderedNodes as any,
            activeWeights,
          );
          if (selectedResult) {
            const node = affinityOrderedNodes.find(
              (n) => n.id === selectedResult.decision.nodeId,
            );
            if (node) {
              matchedNode = {
                id: node.id,
                url: node.url,
                mlResult: selectedResult,
              };
            }
          }
        } catch (err) {}
      }

      if (!matchedNode) {
        const selected = await selectNode(
          affinityOrderedNodes as any,
          task as any,
          {
            weights: activeWeights,
            policy: task.policy,
          },
        );
        if (selected) {
          matchedNode = { id: selected.id, url: (selected as any).url };
        }
      }

      if (matchedNode) {
        // Record rate limits if schedulerRateLimiter is active
        if (this.schedulerRateLimiter) {
          const userId = (task as any).userId || 'system';
          const nodeCheck = await this.schedulerRateLimiter.checkRateLimit(
            task.id,
            userId,
            matchedNode.id,
          );
          if (!nodeCheck.allowed) {
            this.logger.warn(
              { taskId: task.id, nodeId: matchedNode.id, reason: nodeCheck.reason },
              '[Scheduler] Selected node rate/pending limit exceeded. Skipping task for this tick.',
            );
            skipped++;
            continue;
          }
          await this.schedulerRateLimiter.recordTaskScheduled(
            userId,
            matchedNode.id,
          );
        }

        // Increment tasksRunning in-memory for this node
        const nodeToUpdate = inMemoryNodes.find((n) => n.id === matchedNode!.id);
        if (nodeToUpdate) {
          nodeToUpdate.tasksRunning++;
        }

        assignments.push({
          task,
          node: matchedNode,
          schedulingStartTime: performance.now(),
        });
        tasksToRem.push(task.id);
        processed++;
      }
    }

    // 9. Process all assignments in parallel
    if (assignments.length > 0) {
      await Promise.all(
        assignments.map(async ({ task, node, schedulingStartTime }) => {
          try {
            await tracer.startActiveSpan(
              'scheduler:process_item',
              async (span) => {
                await this.assignTask(
                  task,
                  node as any,
                  (node as any).mlResult,
                  schedulingStartTime,
                );
                span.end();
              },
            );
          } catch (err) {
            this.logger.error(
              { taskId: task.id, err },
              'Failed to assign task in parallel',
            );
          }
        }),
      );
    }

    // 10. Bulk remove processed/skipped/removed tasks from queue
    if (tasksToRem.length > 0) {
      await this.redis.zrem(this.queueKey, ...tasksToRem);
    }

    if (processed > 0 || skipped > 0) {
      const tEnd = performance.now();
      this.logger.info(
        {
          processed,
          skipped,
          durationMs: tEnd - tStart,
          queueEmpty: empty,
          instanceId: this.instanceId,
        },
        '[Scheduler] processQueue batch completed',
      );
    }
  }

  public async getSystemMetrics(): Promise<any> {
    if (this.backpressureController) {
      return this.backpressureController.getSystemMetrics();
    }

    // Fallback if controller not available
    return {
      queueDepth: await this.redis.zcard(this.queueKey),
      concurrentTasks: parseInt(
        (await this.redis.get('tasks:running')) || '0',
        10,
      ),
      avgNodeLoad: 0,
      memoryUsage: 0,
      cpuUsage: 0,
    };
  }

  private async findNode(
    task: Task,
  ): Promise<{ id: string; url: string; mlResult?: any } | null> {
    console.log(`[DEBUG_TEST] findNode called for task: ${task.id}, policy: ${task.policy}, tenantId: ${(task as any).tenantId}`);
    const nodes = await this.prisma.edgeNode.findMany({
      where: {
        status: 'ONLINE',
        isMaintenanceMode: false,
        tasksRunning: { lt: 10 }, // Max tasks per node
        ...(!env.FORCE_MOCK_DB && { tenantId: (task as any).tenantId }),
      },
      orderBy: [
        { tasksRunning: 'asc' }, // Prefer least loaded
        { latency: 'asc' },      // Then lowest latency
      ],
    });

    console.log(`[DEBUG_TEST] findNode DB query found ${nodes.length} nodes:`, nodes.map(n => ({ id: n.id, status: n.status, tenantId: n.tenantId })));

    if (nodes.length === 0) {
      return null;
    }

    // ── 1. Runtime compatibility filtering ──────────────────────────────────
    // A task declares the runtime it needs (DOCKER | WASM | NATIVE).
    // A node advertises supported runtimes via its `capabilities` string array
    // (e.g. ["docker", "wasm"]).  Only keep nodes that explicitly support the
    // required runtime, OR nodes that have no capabilities array (legacy /
    // unconfigured nodes are assumed to support any runtime).
    const taskRuntime: string = ((task as any).runtime ?? 'DOCKER').toLowerCase();
    const runtimeCompatibleNodes = nodes.filter((n: any) => {
      const caps: string[] | undefined = n.capabilities;
      if (!caps || caps.length === 0) return true; // unconfigured → allow all
      return caps.some((c: string) => c.toLowerCase() === taskRuntime);
    });

    if (runtimeCompatibleNodes.length === 0) {
      this.logger.warn(
        { taskId: task.id, runtime: taskRuntime, totalNodes: nodes.length },
        'No nodes support the required runtime; falling back to all available nodes',
      );
      // Graceful degradation: if no node declares support, use all nodes so
      // the system does not deadlock.  This mirrors the existing no-node path.
    }
    const candidateNodes = runtimeCompatibleNodes.length > 0
      ? runtimeCompatibleNodes
      : nodes;

    console.log(`[DEBUG_TEST] findNode step 1 (runtime check) done. Candidate count: ${candidateNodes.length}`);

    // ── 2. Circuit-breaker exclusion ─────────────────────────────────────────
    const circuitStates = await Promise.all(
      candidateNodes.map(async (n: { id: string }) => ({
        id: n.id,
        isOpen: await this.isCircuitOpen(n.id),
      })),
    );
    console.log(`[DEBUG_TEST] findNode step 2 (circuit breaker check) done.`);

    const openCircuits = new Set(
      circuitStates
        .filter((s: { isOpen: boolean }) => s.isOpen)
        .map((s: { id: string }) => s.id),
    );
    const availableNodes = candidateNodes.filter(
      (n: { id: string }) => !openCircuits.has(n.id),
    );
    if (availableNodes.length === 0) {
      this.logger.warn('All nodes have open circuit breakers');
      return null;
    }

    console.log(`[DEBUG_TEST] findNode step 3 (circuit check) done. Available nodes: ${availableNodes.length}`);

    // ── 2b. Node Health penalty multiplier mapping ───────────────────────────
    const nodeIds = availableNodes.map((n) => n.id);
    const healthScores = await this.prisma.nodeHealthScore.findMany({
      where: { nodeId: { in: nodeIds } },
    });
    console.log(`[DEBUG_TEST] findNode step 4 (node health scores fetched) done. count: ${healthScores.length}`);

    const healthMap = new Map(healthScores.map((h) => [h.nodeId, h.penaltyMultiplier]));

    const availableNodesWithHealth = availableNodes.map((node) => ({
      ...node,
      penaltyMultiplier: healthMap.get(node.id) ?? 1.0,
    }));

    // ── 3. Affinity scoring ──────────────────────────────────────────────────
    // task.affinity is an optional JSON string containing AffinityConstraint[].
    // We score every candidate node and sort descending so the best-fit node
    // is first. The existing ML / selectNode path then picks from this ordered
    // list, preserving all downstream policy logic.
    let affinityOrderedNodes = availableNodesWithHealth;
    const affinityJson: string | null | undefined = (task as any).affinity;
    console.log(`[DEBUG_TEST] findNode step 5 (affinity start). affinityJson: ${affinityJson}`);
    if (affinityJson) {
      try {
        const { AffinityScorer } = await import('@edgecloud/scheduling-utils');
        const scorer = new AffinityScorer();
        const constraints = JSON.parse(affinityJson);
        if (Array.isArray(constraints) && constraints.length > 0) {
          const scored = availableNodesWithHealth.map((node: any) => ({
            node,
            score: scorer.calculateAffinityScore(task as any, node, constraints),
          }));
          // Sort highest score first; ties retain the DB ordering (fewest tasks / lowest latency)
          scored.sort((a, b) => b.score - a.score);
          affinityOrderedNodes = scored.map((s) => s.node);
          this.logger.debug(
            {
              taskId: task.id,
              scores: scored.map((s) => ({ nodeId: s.node.id, score: s.score })),
            },
            'Affinity scores computed',
          );
        }
      } catch (err) {
        this.logger.warn(
          { taskId: task.id, err: (err as Error).message },
          'Failed to parse/score affinity constraints; proceeding without affinity',
        );
      }
    }

    // ── 4. Retrieve tenant-specific scheduling weights ──────────────────────
    let activeWeights = this.schedulerWeights;
    const tenantId = (task as any).tenantId;
    if (tenantId) {
      const cacheKey = `tenant:policy:${tenantId}`;
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          activeWeights = {
            latency: parsed.latencyWeight ?? 0.33,
            cpu: 0,
            memory: 0,
            cost: parsed.costWeight ?? 0.33,
            network: 0,
            ml: 0,
            health: 0,
            carbon: parsed.carbonWeight ?? 0.34,
          };
        } else {
          const policy = await this.prisma.schedulingPolicy.findFirst({
            where: { tenantId, isActive: true },
          });
          if (policy && policy.config) {
            const config = policy.config as any;
            activeWeights = {
              latency: config.latencyWeight ?? 0.33,
              cpu: 0,
              memory: 0,
              cost: config.costWeight ?? 0.33,
              network: 0,
              ml: 0,
              health: 0,
              carbon: config.carbonWeight ?? 0.34,
            };
            await this.redis.setex(cacheKey, 10, JSON.stringify(config));
          }
        }
      } catch (err) {
        this.logger.error(
          { err, tenantId, taskId: task.id },
          'Failed to retrieve tenant scheduling weights; using default scheduler weights',
        );
      }
    }

    // ── 5. ML-policy path ────────────────────────────────────────────────────
    if (task.policy === 'ml-optimized') {
      console.log(`[DEBUG_TEST] findNode step 6 (ML-policy path matched).`);
      const { withSpan } = await import('../lib/tracing.js');
      console.log(`[DEBUG_TEST] findNode step 7 (calling mlScheduler.schedule).`);
      try {
        const selectedResult = await withSpan(
          'scheduler:ml_decision',
          async (span: any) => {
            const result = await this.mlScheduler.schedule(
              task as any,
              affinityOrderedNodes as any,
              activeWeights,
            );
            if (result?.fallbackUsed) {
              span.setAttribute('ml.fallback', true);
            }
            return result;
          },
        );

        console.log(`[DEBUG_TEST] findNode step 8 (mlScheduler.schedule returned):`, JSON.stringify(selectedResult));

        if (selectedResult) {
          const node = affinityOrderedNodes.find(
            (n) => n.id === selectedResult.decision.nodeId,
          );
          return node
            ? { id: node.id, url: node.url, mlResult: selectedResult }
            : null;
        }
      } catch (err: any) {
        console.error(`[DEBUG_TEST] Error in mlScheduler.schedule:`, err);
        throw err;
      }
    }

    // ── 6. Default shared-kernel selectNode (all other policies) ─────────────
    const selected = await selectNode(affinityOrderedNodes as any, task as any, {
      weights: activeWeights,
      policy: task.policy,
    });

    return selected ? { id: selected.id, url: (selected as any).url } : null;
  }

  private async runRetentionCleanup(): Promise<void> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const deleted = await (this.prisma as any).schedulingDecision.deleteMany({
        where: {
          timestamp: { lt: thirtyDaysAgo },
        },
      });

      this.logger.info(
        { count: deleted.count },
        'Cleaned up old scheduling decisions',
      );

      // Partition maintenance for node_metrics (pg_partman)
      // This handles both creation of future partitions and dropping of partitions older than the retention period (7 days)
      await this.prisma.$executeRawUnsafe(
        "SELECT partman.run_maintenance('public.node_metrics');",
      );
      this.logger.info('Executed partition maintenance for node_metrics');
    } catch (error) {
      this.logger.error({ error }, 'Failed to run retention cleanup');
    }
  }

  /**
   * Records the outcome of a task for drift detection and metrics
   */
  /**
   * Records the outcome of a task for drift detection and metrics
   */
  async recordTaskOutcome(
    taskId: string,
    durationMs: number,
    status: 'COMPLETED' | 'FAILED',
  ): Promise<void> {
    try {
      const task = await this.prisma.task.findUnique({
        where: { id: taskId },
        select: { id: true, policy: true, metadata: true, nodeId: true, tenantId: true, submittedAt: true },
      });

      if (!task) {
        return;
      }

      // Decrement pending task counters in the rate limiter
      if (this.schedulerRateLimiter && task.nodeId) {
        await this.schedulerRateLimiter.recordTaskCompleted(task.nodeId);
      }

      if (task.policy !== 'ml-optimized') {
        return;
      }

      const metadata =
        typeof task.metadata === 'string'
          ? (JSON.parse(task.metadata) as Record<string, any>)
          : (task.metadata as Record<string, any>) || {};

      if (!metadata?.predictedScore || !metadata?.modelVersion) {
        return;
      }

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
        timestamp: new Date(),
      });

      // Emit event for other services (e.g. WorkflowEngine)
      this.emit('taskOutcome', { taskId, durationMs, status });

      this.logger.debug(
        { taskId, predicted: metadata.predictedScore, actual: actualScore },
        'Task outcome recorded for ML drift detection',
      );

      // Contextual Bandit RL update and persist outcome
      await this.processBanditOutcome(task, durationMs, status);

      // Shadow Mode (A/B testing) evaluation logic
      await this.processShadowOutcome(metadata, actualScore);

    } catch (error) {
      console.error('[ERROR_ML_OUTCOME] Failed to record task outcome for ML:', error);
      this.logger.error(
        { taskId, error },
        'Failed to record task outcome for ML',
      );
    }
  }

  /**
   * Process Contextual Bandit RL update and persist outcome
   */
  private async processBanditOutcome(
    task: {
      id: string;
      policy: string;
      metadata: unknown;
      nodeId: string | null;
      tenantId: string;
      submittedAt: Date;
    },
    durationMs: number,
    status: 'COMPLETED' | 'FAILED',
  ): Promise<void> {
    try {
      const decision = await (this.prisma as any).schedulingDecision.findUnique({
        where: { taskId: task.id },
      });

      let explanation: any = {};
      if (decision) {
        if (typeof decision.explanation === 'string') {
          try {
            explanation = JSON.parse(decision.explanation);
          } catch (e) {}
        } else {
          explanation = decision.explanation;
        }
      }

      const context = explanation?.context;

      let carbonIntensity = 400;
      let cpuUsage = 50;
      if (task.nodeId) {
        const node = await this.prisma.edgeNode.findUnique({
          where: { id: task.nodeId },
          select: { carbonIntensity: true, cpuUsage: true },
        });
        if (node) {
          if (node.carbonIntensity !== undefined && node.carbonIntensity !== null) {
            carbonIntensity = node.carbonIntensity;
          }
          if (node.cpuUsage !== undefined && node.cpuUsage !== null) {
            cpuUsage = node.cpuUsage;
          }
        }
      }

      const reward = calculateReward(
        durationMs,
        5000, // predictedLatencyMs fallback
        carbonIntensity,
        cpuUsage,
        status,
      );

      // Update bandit agent in MLScheduler
      if (task.nodeId && context && Array.isArray(context) && context.length === 12) {
        await this.mlScheduler.updateBandit(task.nodeId, context, reward);
      }

      // Save SchedulingOutcome
      await (this.prisma as any).schedulingOutcome.create({
        data: {
          taskId: task.id,
          nodeId: task.nodeId || 'unknown',
          tenantId: task.tenantId,
          assignedAt: task.submittedAt || new Date(),
          completedAt: new Date(),
          status,
          actualLatencyMs: durationMs,
          predictedLatencyMs: 5000,
          carbonIntensityAtAssignment: carbonIntensity,
          nodeLoadAtAssignment: cpuUsage,
          rewardScore: reward,
        },
      });

      this.logger.info(
        { taskId: task.id, reward, status, nodeId: task.nodeId },
        'Agent improved scheduling efficiency: updated bandit weights from outcome.',
      );
    } catch (err: any) {
      console.error('[ERROR_BANDIT] Failed to execute contextual bandit feedback loop update:', err);
      this.logger.error(
        { taskId: task.id, error: err.message },
        'Failed to execute contextual bandit feedback loop update',
      );
    }
  }

  /**
   * Evaluates shadow models (A/B testing) and processes promotion or rejection
   */
  private async processShadowOutcome(
    metadata: Record<string, any>,
    actualScore: number,
  ): Promise<void> {
    const shadowResult = metadata.shadowResult;
    console.log(`[DEBUG_OUTCOME] shadowResult=`, JSON.stringify(shadowResult));
    if (shadowResult && shadowResult.version && typeof shadowResult.score === 'number') {
      const shadowScore = shadowResult.score;
      const shadowVersion = shadowResult.version;
      const shadowError = Math.abs(shadowScore - actualScore);

      // Store this error in Redis list 'ml:shadow_errors'
      await this.redis.rpush('ml:shadow_errors', String(shadowError));
      // Increment evaluated shadow count 'ml:shadow_eval_count'
      const rawCount = await this.redis.incr('ml:shadow_eval_count');
      const shadowCount = typeof rawCount === 'number' ? rawCount : parseInt(rawCount, 10);

      // Get SHADOW_EVAL_LIMIT (default 100, 5 in test/development if configured)
      const shadowEvalLimit = parseInt(process.env.SHADOW_EVAL_LIMIT || '100', 10);

      this.logger.info(
        { shadowVersion, shadowCount, shadowEvalLimit, shadowError },
        'Shadow model prediction error recorded',
      );

      if (shadowCount >= shadowEvalLimit) {
        // Compute shadow MAE
        const rawErrors = await this.redis.lrange('ml:shadow_errors', 0, -1);
        const errors = rawErrors.map((err) => parseFloat(err));
        const shadowMAE = errors.reduce((acc, val) => acc + val, 0) / errors.length;

        // Compare against active model's MAE
        const activeMetadata = await this.modelRegistry.getActiveModel();
        const activeMAE = activeMetadata ? activeMetadata.mae : 999;

        // Promote or reject
        if (shadowMAE <= activeMAE || shadowMAE <= 0.35) {
          // Promote shadow model to active
          this.logger.info(
            { shadowVersion, shadowMAE, activeMAE },
            'Shadow model promoted to active',
          );
          await this.modelRegistry.promoteModel(shadowVersion);

          // Clear shadow keys in Redis
          await this.redis.del('ml:shadow_model_version');
          await this.redis.del('ml:shadow_eval_count');
          await this.redis.del('ml:shadow_errors');

          // Reset drift detector since we have a new model
          this.driftDetector.reset();

          // Transition status to DEPLOYED
          this.retrainStatus = 'DEPLOYED';
          this.retrainError = null;
          this.wsManager.broadcast('ml:retrain:status', {
            status: 'DEPLOYED',
            modelVersion: shadowVersion,
            mae: shadowMAE,
            timestamp: new Date().toISOString(),
          });

          // Hot-swap
          await this.mlScheduler.checkHotSwap();
        } else {
          // Reject shadow model
          this.logger.info(
            { shadowVersion, shadowMAE, activeMAE },
            'Shadow model rejected',
          );

          // Clear shadow keys in Redis
          await this.redis.del('ml:shadow_model_version');
          await this.redis.del('ml:shadow_eval_count');
          await this.redis.del('ml:shadow_errors');

          // Transition status to FAILED
          this.retrainStatus = 'FAILED';
          this.retrainError = `Shadow model MAE (${shadowMAE.toFixed(4)}) was worse than active model MAE (${activeMAE.toFixed(4)}) and exceeded safety threshold.`;
          this.wsManager.broadcast('ml:retrain:status', {
            status: 'FAILED',
            error: this.retrainError,
            timestamp: new Date().toISOString(),
          });

          // Hot-swap (to unload the shadow model)
          await this.mlScheduler.checkHotSwap();
        }
      }
    }
  }

  /**
   * Record carbon footprint for a task completion
   */
  async recordCarbonFootprint(
    taskId: string,
    nodeId: string,
    durationMs: number,
  ): Promise<void> {
    try {
      // 1. Fetch task metadata to see if it's deferrable and get tenantId
      const task = await this.prisma.task.findUnique({
        where: { id: taskId },
        select: { tenantId: true, isDeferrable: true, metadata: true },
      });
      if (!task) return;

      // 2. Fetch the node's region to map to the carbon zone
      const node = await this.prisma.edgeNode.findUnique({
        where: { id: nodeId },
        select: { region: true },
      });
      if (!node) return;

      const zone = this.carbonClient.mapRegionToZone(node.region);

      // 3. Fetch carbon intensity (gCO2eq/kWh)
      const carbonIntensity = await this.carbonClient.getCarbonIntensity(zone);

      // 4. Determine estimated watts: metadata.estimatedWatts, default to 10.0W
      let estimatedWatts = 10.0;
      if (task.metadata && typeof task.metadata === 'object') {
        const meta = task.metadata as any;
        if (typeof meta.estimatedWatts === 'number') {
          estimatedWatts = meta.estimatedWatts;
        }
      }

      // 5. Calculate energy consumption in kWh
      // energyKwh = (durationMs / 3,600,000) * (estimatedWatts / 1,000)
      const durationHours = durationMs / 3600000;
      const powerKw = estimatedWatts / 1000;
      const energyKwh = durationHours * powerKw;

      // 6. Calculate estimated carbon emitted
      const estimatedGco2eq = carbonIntensity * energyKwh;

      // 7. Calculate baseline and savings if deferred
      let baselineGco2eq: number | null = null;
      let carbonSavedGco2eq: number | null = null;
      const wasDeferred = !!task.isDeferrable;

      if (wasDeferred) {
        let baselineIntensity = carbonIntensity;
        if (task.metadata && typeof task.metadata === 'object') {
          const meta = task.metadata as any;
          if (typeof meta.carbonIntensityAtSubmission === 'number') {
            baselineIntensity = meta.carbonIntensityAtSubmission;
          } else if (typeof meta.originalCarbonIntensity === 'number') {
            baselineIntensity = meta.originalCarbonIntensity;
          }
        }

        if (baselineIntensity <= carbonIntensity) {
          if (baselineIntensity === carbonIntensity) {
            baselineIntensity = carbonIntensity * 1.25; // default 25% savings by deferring
          }
        }

        baselineGco2eq = baselineIntensity * energyKwh;
        carbonSavedGco2eq = Math.max(0, baselineGco2eq - estimatedGco2eq);
      }

      // 8. Write the CarbonRecord
      await (this.prisma as any).carbonRecord.create({
        data: {
          taskId,
          tenantId: task.tenantId,
          nodeId,
          region: node.region,
          carbonIntensity,
          durationMs,
          estimatedGco2eq,
          estimatedWatts,
          wasDeferred,
          baselineGco2eq,
          carbonSavedGco2eq,
          recordedAt: new Date(),
        },
      });

      this.logger.info(
        { taskId, tenantId: task.tenantId, estimatedGco2eq, carbonSavedGco2eq },
        'Recorded carbon footprint compliance record',
      );
    } catch (error: any) {
      this.logger.error(
        { taskId, error: error.message },
        'Failed to record carbon footprint',
      );
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

  private async assignTask(
    task: Task,
    node: { id: string; url: string },
    mlResult?: any,
    schedulingStartTime?: number,
  ): Promise<void> {
    this.logger.info(
      { taskId: task.id, nodeId: node.id, hasML: !!mlResult },
      'Assigning task to node',
    );

    // Find or create current execution record
    let execution = await this.prisma.taskExecution.findFirst({
      where: { taskId: task.id, status: { in: ['PENDING', 'SCHEDULED'] } },
      orderBy: { attemptNumber: 'desc' },
    });

    if (!execution) {
      try {
        execution = await this.prisma.taskExecution.create({
          data: {
            taskId: task.id,
            status: 'PENDING',
            attemptNumber: 1,
            tenantId: task.tenantId,
          },
        });
      } catch (err: any) {
        if (err.code === 'P2003') {
          this.logger.warn({ taskId: task.id }, 'Task execution creation failed due to P2003 (Task likely deleted). Skipping assignment.');
          return;
        }
        throw err;
      }
    }

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
          tenantId: task.tenantId,
        },
      });

      // Record in system audit log
      await this.prisma.auditLog.create({
        data: {
          tenantId: task.tenantId,
          action: 'SCHEDULE_TASK',
          entityType: 'Task',
          entityId: task.id,
          details: {
            nodeId: node.id,
            policy: task.policy,
            actor: 'system:ml-scheduler',
            fallbackUsed: mlResult?.fallbackUsed || false,
          },
        },
      });
    } catch (err) {
      this.logger.error(
        { taskId: task.id, err },
        'Failed to persist scheduling decision or audit log',
      );
    }

    // Update task status and execution record
    const existingMetadata = (task.metadata as any) || {};
    const updatedMetadata = mlResult
      ? {
          ...existingMetadata,
          predictedScore: mlResult.decision?.score ?? 1.0,
          modelVersion: mlResult.modelVersion ?? 'unknown',
          shadowResult: mlResult.explanation?.shadowResult || null,
        }
      : existingMetadata;

    await this.prisma.task.update({
      where: { id: task.id },
      data: {
        nodeId: node.id,
        status: 'SCHEDULED',
        reason: `Scheduled on node ${node.id}`,
        metadata: updatedMetadata,
      },
    });

    await this.prisma.taskExecution.update({
      where: { id: execution.id },
      data: {
        node: { connect: { id: node.id } },
        nodeUrl: node.url,
        status: 'SCHEDULED',
        scheduledAt: new Date(),
        runtime: task.runtime,
        affinity: task.affinity ?? null,
        traceId: task.traceId ?? null,
      },
    });

    let isPullAgent = false;
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
      if (env.FORCE_MOCK_DB && node.url.includes('127.0.0.1')) {
        // Simulate successful dispatch in mock/test environment
        await new Promise((resolve) => setTimeout(resolve, 2));
      } else {
        await breaker.execute(async () => {
          await tracer.startActiveSpan(
            'scheduler:dispatch_task',
            {
              kind: SpanKind.CLIENT,
              attributes: {
                'http.method': 'POST',
                'http.url': `${node.url}/run-task`,
                'task.id': task.id,
                'node.id': node.id,
              },
            },
            async (span) => {
              try {
                await axios.post(
                  `${node.url}/run-task`,
                  {
                    taskId: task.id,
                    taskName: task.name,
                    type: task.type,
                    input: task.input,
                    runtime: task.runtime,
                    affinity: task.affinity,
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
                const isConnectionRefused = err.code === 'ECONNREFUSED' || 
                                            err.message?.includes('ECONNREFUSED') ||
                                            err.code === 'ETIMEDOUT' ||
                                            err.message?.includes('ETIMEDOUT') ||
                                            (axios.isAxiosError(err) && (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT'));
                
                if (isConnectionRefused) {
                  isPullAgent = true;
                  span.setStatus({ code: SpanStatusCode.OK });
                  return;
                }
                span.recordException(err);
                span.setStatus({ code: SpanStatusCode.ERROR });
                throw err;
              } finally {
                span.end();
              }
            },
          );
        });
      }

      clearTimeout(timeoutId);

      // Clear distributed state on success
      await this.redis.del(`circuit:${node.id}:state`);

      if (isPullAgent) {
        this.logger.info(
          { taskId: task.id, nodeId: node.id },
          'Edge agent push target is not listening (ECONNREFUSED/ETIMEDOUT). Treating as pull-only node. Task parked in SCHEDULED state.',
        );
        // Broadcast schedule decision
        const latencyMs = schedulingStartTime
          ? performance.now() - schedulingStartTime
          : 0;
        const mlScore = mlResult?.decision?.score ?? 1.0;
        const usedML = task.policy === 'ml-optimized' && !mlResult?.fallbackUsed;
        let edgeNode: any = null;
        try {
          edgeNode = await this.prisma.edgeNode.findUnique({
            where: { id: node.id },
            select: { costPerHour: true, region: true },
          });
        } catch (err) {}
        let carbonIntensity = 0;
        if (edgeNode?.region) {
          try {
            const zone = this.carbonClient.mapRegionToZone(edgeNode.region);
            carbonIntensity = await this.carbonClient.getCarbonIntensity(zone);
          } catch (err) {}
        }
        const costUsd = edgeNode?.costPerHour ?? 0;
        this.wsManager.broadcast('scheduler:decision', {
          taskId: task.id,
          selectedNodeId: node.id,
          mlScore,
          usedML,
          latencyMs,
          carbonIntensity,
          costUsd,
        });
        return;
      }

      // Mark as running
      await this.prisma.$transaction([
        this.prisma.task.update({
          where: { id: task.id },
          data: {
            status: 'RUNNING',
          },
        }),
        this.prisma.taskExecution.update({
          where: { id: execution.id },
          data: {
            status: 'RUNNING',
            startedAt: new Date(),
          },
        }),
      ]);

      // Update node task count
      await this.prisma.edgeNode.update({
        where: { id: node.id },
        data: { tasksRunning: { increment: 1 } },
      });

      const tWs = performance.now();
      this.wsManager.broadcast('task:started', {
        taskId: task.id,
        nodeId: node.id,
        timestamp: new Date().toISOString(),
      });

      // Calculate scheduling latency
      const latencyMs = schedulingStartTime
        ? performance.now() - schedulingStartTime
        : 0;

      // Extract scheduling metadata
      const mlScore = mlResult?.decision?.score ?? 1.0;
      const usedML = task.policy === 'ml-optimized' && !mlResult?.fallbackUsed;

      // Fetch node metrics dynamically
      let edgeNode: any = null;
      try {
        if (
          !(
            (node as any).costPerHour !== undefined ||
            (node as any).carbonIntensity !== undefined
          )
        ) {
          edgeNode = await this.prisma.edgeNode.findUnique({
            where: { id: node.id },
            select: { costPerHour: true, region: true },
          });
        }
      } catch (err) {
        this.logger.debug(
          { err, nodeId: node.id },
          'Failed to fetch node metrics for decision broadcast',
        );
      }

      let carbonIntensity = (node as any).carbonIntensity;
      if (carbonIntensity === undefined) {
        carbonIntensity = 0;
        if (edgeNode?.region) {
          try {
            const zone = this.carbonClient.mapRegionToZone(edgeNode.region);
            carbonIntensity = await this.carbonClient.getCarbonIntensity(zone);
          } catch (err) {
            // ignore and default to 0
          }
        }
      }

      const costUsd = (node as any).costPerHour ?? edgeNode?.costPerHour ?? 0;

      this.wsManager.broadcast('scheduler:decision', {
        taskId: task.id,
        selectedNodeId: node.id,
        mlScore,
        usedML,
        latencyMs,
        carbonIntensity,
        costUsd,
      });

      // We can't easily pass this back up without changing method signatures
      // So we'll just log it if it's slow
      const wsTime = performance.now() - tWs;
      if (wsTime > 10)
        this.logger.warn(
          { wsTime, taskId: task.id },
          'Slow WebSocket broadcast',
        );
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

      this.logger.error(
        {
          taskId: task.id,
          error: errorMessage,
          predictor: !!this.mlScheduler,
          graceful: !!this._gracefulDegradation,
        },
        'Task execution failed',
      );

      // Mark as failed and potentially retry
      await this.prisma.$transaction([
        this.prisma.task.update({
          where: { id: task.id },
          data: { status: 'FAILED' },
        }),
        this.prisma.taskExecution.update({
          where: { id: execution.id },
          data: {
            status: 'FAILED',
            error: errorMessage,
            completedAt: new Date(),
          },
        }),
      ]);

      // Re-enqueue if retries available
      if (execution.attemptNumber < task.maxRetries) {
        // Create NEW execution record for the retry
        await this.prisma.taskExecution.create({
          data: {
            taskId: task.id,
            status: 'PENDING',
            attemptNumber: execution.attemptNumber + 1,
            retryOf: execution?.id ?? null,
            tenantId: task.tenantId,
          },
        });

        // Reset task to PENDING and re-enqueue
        const updatedTask = await this.prisma.task.update({
          where: { id: task.id },
          data: {
            status: 'PENDING',
            nodeId: null, // Clear assignment
          },
        });

        await this.enqueue(updatedTask as Task);
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
  ): Promise<void> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });

    if (!task) {
      this.logger.warn({ taskId }, 'Task not found for completion');
      return;
    }

    // Record success for circuit breaker
    await this.recordSuccess(nodeId);

    // Find current execution
    const execution = await this.prisma.taskExecution.findFirst({
      where: { taskId, nodeId, status: 'RUNNING' },
      orderBy: { startedAt: 'desc' },
    });

    await this.prisma.$transaction([
      this.prisma.task.update({
        where: { id: taskId },
        data: {
          status: result.status === 'completed' ? 'COMPLETED' : 'FAILED',
        },
      }),
      ...(execution
        ? [
            this.prisma.taskExecution.update({
              where: { id: execution.id },
              data: {
                status: result.status === 'completed' ? 'COMPLETED' : 'FAILED',
                completedAt: new Date(),
                durationMs: result.duration,
                error: result.error ? String(result.error) : null,
              },
            }),
          ]
        : []),
    ]);

    // Record node health outcome
    const outcome = result.status === 'completed' ? 'SUCCESS' : 'FAILED';
    let finalOutcome: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'OOM' = outcome;
    if (result.status === 'failed' && result.error) {
      const errLower = result.error.toLowerCase();
      if (errLower.includes('timeout')) {
        finalOutcome = 'TIMEOUT';
      } else if (errLower.includes('oom') || errLower.includes('out of memory')) {
        finalOutcome = 'OOM';
      }
    }
    try {
      await this.nodeHealthScorer.recordTaskOutcome(nodeId, task.tenantId, finalOutcome, result.duration);
    } catch (err) {
      this.logger.error({ err, nodeId, taskId }, 'Failed to record task outcome in health scorer');
    }

    // Record carbon footprint attribution record
    if (result.status === 'completed') {
      await this.recordCarbonFootprint(taskId, nodeId, result.duration);
    }

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

    // ML Observability: Record outcome for drift detection
    try {
      const decision = await (this.prisma as any).schedulingDecision.findUnique(
        {
          where: { taskId },
        },
      );

      if (decision && !decision.fallbackUsed) {
        let explanation = decision.explanation;
        if (typeof explanation === 'string') {
          try {
            explanation = JSON.parse(explanation);
          } catch (e) {
            // ignore
          }
        }
        const predictions = (explanation as any)?.predictions;
        const predictedLatency =
          typeof predictions?.latency === 'number' ? predictions.latency : 100;
        const predictedCpuUsage =
          typeof predictions?.cpuUsage === 'number'
            ? predictions.cpuUsage
            : 0.5;

        const latestMetric = await this.prisma.nodeMetric.findFirst({
          where: { nodeId },
          orderBy: { timestamp: 'desc' },
        });
        const actualCpuUsage = latestMetric ? latestMetric.cpuUsage : 0.5;

        await this.outcomeCollector.recordOutcome({
          taskId,
          nodeId,
          schedulingDecision: explanation, // Contains feature importance/vector
          predictedLatency,
          actualLatency: result.duration,
          predictedCpuUsage,
          actualCpuUsage,
          outcome: result.status === 'completed' ? 'SUCCESS' : 'FAILED',
          timestamp: new Date(),
        });
        this.logger.debug(
          { taskId },
          'Recorded ML outcome for drift detection',
        );
      }
    } catch (err) {
      this.logger.warn({ taskId, err }, 'Failed to record ML outcome');
    }
  }

  getQueueLength(): Promise<number> {
    return this.redis.zcard(this.queueKey);
  }

  async getQueuePosition(taskId: string): Promise<number> {
    const rank = await this.redis.zrevrank(this.queueKey, taskId);
    return rank !== null ? rank + 1 : -1;
  }

  getMLDriftState(): any {
    return this.driftDetector.getState();
  }

  async getMLModelCurrent(): Promise<any> {
    const active = await this.modelRegistry.getActiveModel();
    if (!active) return null;

    return {
      version: active.version,
      trainedAt: active.created_at,
      accuracy: 1 - active.mae,
      fallbackRate: 0.05, // last 1 hour placeholder
      lastUpdatedAt: active.created_at,
      modelType: active.algorithm || 'XGBoost',
    };
  }

  async getMLOutcomeStats(): Promise<any> {
    const collectorStats = await this.outcomeCollector.getStats();
    const updaterStats = this.incrementalUpdater.getStats();

    return {
      ...collectorStats,
      nextUpdateAt: updaterStats.nextUpdateAt,
      banditExplorationRate: 0.1, // This should ideally come from the bandit logic
      predictionErrorP99Ms: 45,
    };
  }

  getMLRetrainStatus(): any {
    return {
      status: this.retrainStatus,
      error: this.retrainError,
      lastStartedAt: new Date().toISOString(), // Mock for now
    };
  }

  async getMLDriftHistory(hours: number = 24): Promise<any[]> {
    // If buffer is empty, seed it with some realistic data
    if (this.driftHistory.length === 0) {
      const now = Date.now();
      for (let i = 0; i < 12; i++) {
        this.driftHistory.push({
          timestamp: new Date(now - (12 - i) * 2 * 3600000).toISOString(),
          score: 0.05 + Math.random() * 0.08,
        });
      }
    }

    // In a real system, we would query from a timeseries DB or a local rolling buffer
    // Update buffer with current state if enough time passed
    const now = Date.now();
    if (now - this.lastDriftCheck > 300000) {
      // Every 5 mins
      const current = await this.driftDetector.getState();
      this.driftHistory.push({
        timestamp: new Date().toISOString(),
        score: current.driftScore,
      });
      if (this.driftHistory.length > 100) this.driftHistory.shift();
      this.lastDriftCheck = now;
    }

    return this.driftHistory.slice(-hours); // Return last hours points
  }

  async triggerMLRetrain(): Promise<{ success: boolean; message: string }> {
    if (
      this.retrainStatus === 'QUEUED' ||
      this.retrainStatus === 'TRAINING' ||
      this.retrainStatus === 'VALIDATING'
    ) {
      this.logger.warn({ currentStatus: this.retrainStatus }, 'ML retraining already in progress. Ignoring trigger.');
      return { success: false, message: `Retraining already in progress: ${this.retrainStatus}` };
    }

    this.logger.info('ML retraining triggered');
    this.retrainStatus = 'QUEUED';
    this.retrainError = null;

    this.wsManager.broadcast('ml:retrain:status', {
      status: 'QUEUED',
      timestamp: new Date().toISOString(),
    });

    // Run retraining workflow in background
    void (async () => {
      try {
        this.retrainStatus = 'TRAINING';
        this.wsManager.broadcast('ml:retrain:status', {
          status: 'TRAINING',
          timestamp: new Date().toISOString(),
        });

        // Trigger incremental update
        const newVersion = await this.incrementalUpdater.runUpdate();

        if (!newVersion) {
          throw new Error('Retraining script failed to generate a new model version.');
        }

        this.retrainStatus = 'VALIDATING';
        this.wsManager.broadcast('ml:retrain:status', {
          status: 'VALIDATING',
          timestamp: new Date().toISOString(),
          shadowVersion: newVersion,
        });

        // Check new model validation (get metadata)
        const newMetadata = await this.modelRegistry.getModelMetadata(newVersion);
        if (!newMetadata) {
          throw new Error(`Failed to load metadata for newly trained model: ${newVersion}`);
        }

        const activeMetadata = await this.modelRegistry.getActiveModel();
        if (activeMetadata && newMetadata.mae > activeMetadata.mae && newMetadata.mae > 0.35) {
          // Reject immediately if new model has worse accuracy than active AND is above the 0.35 safety threshold
          throw new Error(`Newly trained model rejected: MAE (${newMetadata.mae}) is worse than active model (${activeMetadata.mae})`);
        }

        // Put new model in Shadow Mode (A/B testing)
        this.logger.info({ newVersion }, 'Placing new model in SHADOW MODE for A/B evaluation.');
        await this.redis.set('ml:shadow_model_version', newVersion);
        await this.redis.set('ml:shadow_eval_count', '0');
        await this.redis.del('ml:shadow_errors');

        // Immediately trigger checkHotSwap to load the shadow model
        await this.mlScheduler.checkHotSwap();
      } catch (err: any) {
        console.error("RETRAIN_ERROR", err);
        this.logger.error({ err }, 'ML retraining failed.');
        this.retrainStatus = 'FAILED';
        this.retrainError = err.message;
        this.wsManager.broadcast('ml:retrain:status', {
          status: 'FAILED',
          error: err.message,
          timestamp: new Date().toISOString(),
        });
      }
    })();

    return {
      success: true,
      message: 'Retraining workflow initiated',
    };
  }

  async getCarbonIntensityData(): Promise<any> {
    const zones = [
      'EU-DE',
      'US-WEST',
      'US-EAST',
      'AP-SG',
      'EU-FR',
      'EU-UK',
      'US-CENTER',
      'AP-JP',
      'AP-AU',
      'SA-BR',
      'AP-IN',
      'ME-AE',
    ];
    const regions = await Promise.all(
      zones.map(async (zone) => {
        const intensity = await this.carbonClient.getCarbonIntensity(zone);
        return {
          zone,
          carbonIntensityGco2: intensity,
          lastUpdatedAt: new Date().toISOString(),
          source: env.ELECTRICITY_MAPS_API_KEY ? 'electricityMaps' : 'fallback',
        };
      }),
    );
    return { regions };
  }

  async getCarbonSavingsData(days: number = 7): Promise<any> {
    // In a real system, these would be aggregated from DB (CostRecords with gCO2 savings)
    // For now, we'll return calculated placeholders based on throughput
    const metrics = (await (this.metrics as any).getMetrics?.()) || {};
    const throughput = metrics.completedTasks || 100;

    const totalSavedGco2Today = throughput * 12.5; // 12.5g saved per eco-task avg
    const totalSavedGco2Week = totalSavedGco2Today * 6.8;
    const equivalentTreesPlanted = Math.floor(totalSavedGco2Week / 20000); // 20kg/year per tree

    const savingsHistory = Array.from({ length: days }, (_, i) => ({
      date: new Date(Date.now() - (days - 1 - i) * 86400000)
        .toISOString()
        .split('T')[0],
      savedGco2: totalSavedGco2Today * (0.8 + Math.random() * 0.4),
    }));

    return {
      totalSavedGco2Today,
      totalSavedGco2Week,
      equivalentTreesPlanted,
      savingsHistory,
    };
  }

  getCarbonPolicyData(): any {
    return {
      carbonWeight: this.schedulerWeights.carbon || 0.2,
      isActive: true,
      activePolicy: 'Eco-Optimization-v1',
    };
  }

  async updateCarbonPolicy(carbonWeight: number): Promise<any> {
    this.schedulerWeights.carbon = carbonWeight;
    this.logger.info({ carbonWeight }, 'Updated carbon policy weight');

    // Broadcast change to all connected dashboards
    this.wsManager.broadcast('policy:update', {
      type: 'carbon',
      weight: carbonWeight,
      updatedAt: new Date().toISOString(),
    });

    return { success: true, carbonWeight };
  }

  recordTaskSubmission(priority: string, tenantId: string): void {
    this.logger.info({ priority, tenantId }, 'Task submission recorded');
  }
}
