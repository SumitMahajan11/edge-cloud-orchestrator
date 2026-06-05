/**
 * AutoHealer - Self-Healing Service
 *
 * Monitors system health and automatically takes corrective actions when
 * failures are detected. Integrates with Prometheus alerts and Kubernetes.
 *
 * Capabilities:
 * - Node failure detection and task rescheduling
 * - Service crash recovery via Kubernetes
 * - High load mitigation through scaling
 * - Kafka consumer lag handling
 */
import {
  determineHealingAction,
  type HealingAction as DomainHealingAction,
  LeaderElection,
  SCHEDULER_CONSTANTS,
} from '@edgecloud/shared-kernel';
import { PrismaClient } from '@prisma/client';
import { spawn } from 'child_process';
import { EventEmitter } from 'eventemitter3';
import Redis from 'ioredis';
import type { Logger } from 'pino';

import { retry } from '../utils/retry.util';
import { env } from '../config/env';
// Constants for spawn operations
const SPAWN_TIMEOUT_MS = 10000; // 10 seconds timeout for kubectl commands

// ============================================================================
// Types
// ============================================================================

export type HealingAction = DomainHealingAction & {
  id: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  metadata?: Record<string, unknown>;
};

export interface AlertPayload {
  status: 'firing' | 'resolved';
  alerts: Array<{
    labels: Record<string, string>;
    annotations: Record<string, string>;
    state: string;
    activeAt: string;
    value: string;
  }>;
  externalURL: string;
  version: string;
  groupKey: string;
}

export interface AutoHealerConfig {
  cooldownMs: number;
  maxConcurrentActions: number;
  enableKubernetesActions: boolean;
  kubernetesNamespace: string;
  prometheusUrl: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: AutoHealerConfig = {
  cooldownMs: env.HEALER_COOLDOWN_MS,
  maxConcurrentActions: env.HEALER_MAX_CONCURRENT,
  enableKubernetesActions: env.HEALER_K8S_ENABLED,
  kubernetesNamespace: env.HEALER_K8S_NAMESPACE,
  prometheusUrl: env.PROMETHEUS_URL,
};

// Recovery storm prevention
const MAX_RECOVERY_ACTIONS_PER_MINUTE = 10;
const MAX_RESTARTS_PER_SERVICE_PER_HOUR = 3;
const RECOVERY_BULKHEAD_LIMIT = 3; // Max parallel recovery actions of same type
const GLOBAL_RECOVERY_COOLDOWN = 30000; // Global cooldown after any recovery action

// Track recovery actions for storm prevention
const recoveryActionHistory: Map<string, number[]> = new Map();
let lastGlobalRecoveryTime = 0;

// ============================================================================
// AutoHealer Service
// ============================================================================

export class AutoHealer extends EventEmitter {
  private prisma: PrismaClient;
  private redis: Redis;
  private logger: Logger;
  private config: AutoHealerConfig;
  private activeActions: Map<string, HealingAction> = new Map();
  private actionHistory: HealingAction[] = [];
  private isProcessing: boolean = false;
  private alertCheckInterval: ReturnType<typeof setInterval> | null = null;
  private leaderElection: LeaderElection;
  private instanceId: string;
  private subscriber: Redis | null = null;

  constructor(
    prisma: PrismaClient,
    redis: Redis,
    logger: Logger,
    config: Partial<AutoHealerConfig> = {},
  ) {
    super();
    this.prisma = prisma;
    this.redis = redis;
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.instanceId = `healer-${Math.random().toString(36).substring(2, 9)}`;

    this.leaderElection = new LeaderElection(redis, logger, {
      lockKey: SCHEDULER_CONSTANTS.HEALER_LOCK_KEY,
      ttl: SCHEDULER_CONSTANTS.LEADER_LOCK_TTL_MS,
      unlockOnStop: true,
    });
  }

  /**
   * Start the auto-healer
   */
  async start(): Promise<void> {
    // Subscribe to alert channel
    this.subscribeToAlerts();

    // Start leader election
    await this.leaderElection.start(
      this.instanceId,
      SCHEDULER_CONSTANTS.LEADER_LOCK_TTL_MS,
    );

    // Periodic health check
    this.alertCheckInterval = setInterval(() => {
      void this.performHealthChecks();
    }, 30000);

    this.logger.info({ instanceId: this.instanceId }, 'Auto-healer started');
    this.emit('started');
  }

  /**
   * Stop the auto-healer
   */
  async stop(): Promise<void> {
    if (this.alertCheckInterval) {
      clearInterval(this.alertCheckInterval);
      this.alertCheckInterval = null;
    }

    await this.leaderElection.stop();

    if (this.subscriber) {
      try {
        await this.subscriber.quit();
      } catch (err) {
        this.logger.error(err, 'Failed to quit alert subscriber');
      }
      this.subscriber = null;
    }

    this.removeAllListeners();

    this.logger.info('Auto-healer stopped');
    this.emit('stopped');
  }

  /**
   * Subscribe to Redis alert channel
   */
  private subscribeToAlerts(): void {
    this.subscriber = this.redis.duplicate();
    void this.subscriber.subscribe('alerts:prometheus', 'alerts:custom');

    this.subscriber.on('message', (channel, message) => {
      try {
        const alert = JSON.parse(message);
        void this.handleAlert(alert);
      } catch (error) {
        this.logger.error({ error, channel }, 'Failed to parse alert message');
      }
    });
  }

  /**
   * Handle incoming alert
   */
  async handleAlert(alert: AlertPayload): Promise<void> {
    if (alert.status !== 'firing') {
      return;
    }

    for (const a of alert.alerts) {
      const actionType = this.determineActionType(a);

      if (actionType) {
        await this.initiateHealing(actionType, a);
      }
    }
  }

  /**
   * Determine healing action from alert
   */
  private determineActionType(
    alert: AlertPayload['alerts'][0],
  ): HealingAction['type'] | null {
    const action = determineHealingAction(alert as any);
    return action ? action.type : null;
  }

  /**
   * Initiate a healing action
   */
  async initiateHealing(
    type: HealingAction['type'],
    alert: AlertPayload['alerts'][0],
  ): Promise<HealingAction | null> {
    const target =
      alert.labels.instance ||
      alert.labels.service ||
      alert.labels.node ||
      'unknown';
    const actionId = `${type}-${target}-${Date.now()}`;

    // Check cooldown
    if (this.isOnCooldown(type, target)) {
      this.logger.info({ type, target }, 'Healing action on cooldown');
      return null;
    }

    // Check concurrent actions limit
    if (this.activeActions.size >= this.config.maxConcurrentActions) {
      this.logger.warn('Max concurrent healing actions reached');
      return null;
    }

    const action: HealingAction = {
      id: actionId,
      type,
      target,
      reason:
        alert.annotations.summary ||
        alert.annotations.description ||
        'Alert triggered',
      status: 'in-progress',
      startedAt: new Date(),
      metadata: {
        alertLabels: alert.labels,
        alertValue: alert.value,
      },
    };

    this.activeActions.set(actionId, action);
    this.setCooldown(type, target);

    this.logger.info({ actionId, type, target }, 'Initiating healing action');
    this.emit('action_started', action);

    try {
      await this.executeAction(action);
      action.status = 'completed';
      action.completedAt = new Date();
      this.emit('action_completed', action);
    } catch (error) {
      action.status = 'failed';
      action.error = (error as Error).message;
      action.completedAt = new Date();
      this.emit('action_failed', action);
    } finally {
      this.activeActions.delete(actionId);
      this.actionHistory.push(action);
      // Keep only last 100 actions
      if (this.actionHistory.length > 100) {
        this.actionHistory.shift();
      }
    }

    return action;
  }

  /**
   * Execute a healing action
   */
  private async executeAction(action: HealingAction): Promise<void> {
    switch (action.type) {
      case 'reschedule-tasks':
        await this.rescheduleTasksFromNode(action.target);
        break;
      case 'restart-service':
        await this.restartService(action.target);
        break;
      case 'scale-up':
        await this.scaleService(action.target, 1);
        break;
      case 'scale-down':
        await this.scaleService(action.target, -1);
        break;
      case 'clear-queue':
        await this.clearQueue(action.target);
        break;
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  /**
   * Reschedule tasks from a failed node
   */
  private async rescheduleTasksFromNode(nodeId: string): Promise<void> {
    this.logger.info({ nodeId }, 'Rescheduling tasks from failed node');

    // Find all tasks on the node
    const tasks = await this.prisma.task.findMany({
      where: {
        nodeId,
        status: { in: ['SCHEDULED', 'RUNNING'] },
      },
    });

    this.logger.info(
      { nodeId, taskCount: tasks.length },
      'Found tasks to reschedule',
    );

    for (const task of tasks) {
      // Reset task to PENDING
      await retry(() =>
        this.prisma.task.update({
          where: { id: task.id },
          data: {
            nodeId: null,
            status: 'PENDING',
            reason: `Rescheduled due to node ${nodeId} failure`,
          },
        }),
      );
      // Add back to queue
      await this.redis.zadd('task:queue', Date.now(), task.id);

      this.emit('task_rescheduled', { taskId: task.id, fromNode: nodeId });
    }

    // Mark node as OFFLINE
    await this.prisma.edgeNode.update({
      where: { id: nodeId },
      data: { status: 'OFFLINE' },
    });
  }

  /**
   * Restart a Kubernetes service
   */
  private async restartService(serviceName: string): Promise<void> {
    if (!this.config.enableKubernetesActions) {
      this.logger.warn('Kubernetes actions disabled, skipping restart');
      return;
    }

    this.logger.info({ serviceName }, 'Restarting service');

    try {
      // Validate inputs to prevent injection
      const namespace = this.config.kubernetesNamespace;
      if (
        !this.isValidK8sName(serviceName) ||
        !this.isValidK8sName(namespace)
      ) {
        throw new Error('Invalid service name or namespace');
      }

      // Execute kubectl with timeout
      await this.spawnWithTimeout(
        'kubectl',
        ['rollout', 'restart', `deployment/${serviceName}`, '-n', namespace],
        `restart ${serviceName} in ${namespace}`,
      );

      this.emit('service_restarted', { serviceName });
    } catch (error) {
      this.logger.error({ error, serviceName }, 'Failed to restart service');
      throw error;
    }
  }

  /**
   * Scale a service
   */
  private async scaleService(
    serviceName: string,
    delta: number,
  ): Promise<void> {
    if (!this.config.enableKubernetesActions) {
      this.logger.warn('Kubernetes actions disabled, skipping scale');
      return;
    }

    this.logger.info({ serviceName, delta }, 'Scaling service');

    try {
      // Validate inputs to prevent injection
      const namespace = this.config.kubernetesNamespace;
      if (
        !this.isValidK8sName(serviceName) ||
        !this.isValidK8sName(namespace)
      ) {
        throw new Error('Invalid service name or namespace');
      }

      // Get current replicas first (with fallback)
      const currentReplicas = await this.getCurrentReplicas(
        serviceName,
        namespace,
      );
      const newReplicas = Math.max(0, currentReplicas + delta);

      // Execute scale with timeout
      await this.spawnWithTimeout(
        'kubectl',
        [
          'scale',
          'deployment',
          serviceName,
          '--replicas',
          newReplicas.toString(),
          '-n',
          namespace,
        ],
        `scale ${serviceName} to ${newReplicas} in ${namespace}`,
      );

      this.emit('service_scaled', { serviceName, delta });
    } catch (error) {
      this.logger.error({ error, serviceName }, 'Failed to scale service');
      throw error;
    }
  }

  /**
   * Get current replica count for a deployment
   * Returns safe default (1) on failure to allow scaling operations to continue
   */
  private async getCurrentReplicas(
    serviceName: string,
    namespace: string,
  ): Promise<number> {
    try {
      const stdout = await this.spawnWithTimeout(
        'kubectl',
        [
          'get',
          'deployment',
          serviceName,
          '-n',
          namespace,
          '-o',
          'jsonpath={.spec.replicas}',
        ],
        `get replicas for ${serviceName} in ${namespace}`,
        SPAWN_TIMEOUT_MS,
      );

      const replicas = parseInt(stdout, 10);
      if (isNaN(replicas)) {
        this.logger.warn(
          { serviceName, stdout },
          'Failed to parse replica count, using default of 1',
        );
        return 1; // Safe default
      }
      return replicas;
    } catch (error) {
      this.logger.warn(
        { error, serviceName, namespace },
        'Failed to get current replicas, using default of 1',
      );
      return 1; // Safe default allows scaling to continue
    }
  }

  /**
   * Clear a queue
   */
  private async clearQueue(queueName: string): Promise<void> {
    await this.redis.del(queueName);
    this.emit('queue_cleared', { queueName });
  }

  /**
   * Validate Kubernetes resource names to prevent injection
   * Only allows alphanumeric, hyphens, and dots
   */
  private isValidK8sName(name: string): boolean {
    if (!name || typeof name !== 'string') {
      return false;
    }
    // Kubernetes names must be DNS-1123 subdomain compliant
    // lowercase alphanumeric, hyphens, and dots
    const k8sNameRegex =
      /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
    return k8sNameRegex.test(name) && name.length <= 253;
  }

  /**
   * Spawn a process with timeout protection
   * Kills process if timeout exceeded, prevents hanging
   */
  private spawnWithTimeout(
    command: string,
    args: string[],
    operation: string,
    timeoutMs: number = SPAWN_TIMEOUT_MS,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      // Set timeout
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill('SIGTERM');
          // Force kill after grace period
          setTimeout(() => proc.kill('SIGKILL'), 5000);
          reject(new Error(`Timeout: ${operation} exceeded ${timeoutMs}ms`));
        }
      }, timeoutMs);

      // Capture output
      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle completion
      proc.on('close', (code: number | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);

        if (code === 0) {
          resolve(stdout.trim());
        } else {
          const errorMsg = stderr.trim() || `Process exited with code ${code}`;
          reject(new Error(`Failed to ${operation}: ${errorMsg}`));
        }
      });

      // Handle spawn errors
      proc.on('error', (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn ${command}: ${error.message}`));
      });
    });
  }

  /**
   * Perform periodic health checks
   */
  private async performHealthChecks(): Promise<void> {
    if (this.isProcessing || !this.leaderElection.isCurrentlyLeader()) {
      return;
    }
    this.isProcessing = true;

    try {
      // Check failed tasks for retries
      await this.checkFailedTasks();

      // Check node health
      await this.checkNodeHealth();

      // Check service health
      await this.checkServiceHealth();

      // Check queue depths
      await this.checkQueueDepths();
    } catch (error) {
      this.logger.error({ error }, 'Error during health checks');
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Check node health
   */
  private async checkNodeHealth(): Promise<void> {
    const staleThreshold = Date.now() - 120000; // 2 minutes

    const staleNodes = await this.prisma.edgeNode.findMany({
      where: {
        status: 'ONLINE',
        lastHeartbeat: { lt: new Date(staleThreshold) },
      },
    });

    for (const node of staleNodes) {
      this.logger.warn({ nodeId: node.id }, 'Detected stale node');
      await this.initiateHealing('reschedule-tasks', {
        labels: { alertname: 'NodeStale', node: node.id },
        annotations: { summary: `Node ${node.id} has not sent heartbeat` },
        state: 'firing',
        activeAt: new Date().toISOString(),
        value: '1',
      });
    }
  }

  /**
   * Check service health
   */
  private async checkServiceHealth(): Promise<void> {
    if (!this.config.enableKubernetesActions) return;

    try {
      const namespace = this.config.kubernetesNamespace;
      const stdout = await this.spawnWithTimeout(
        'kubectl',
        ['get', 'pods', '-n', namespace, '-o', 'json'],
        `check pod health in ${namespace}`,
      );

      const pods = JSON.parse(stdout);
      for (const pod of pods.items || []) {
        const containerStatuses = pod.status?.containerStatuses || [];
        for (const status of containerStatuses) {
          if (status.state?.waiting?.reason === 'CrashLoopBackOff') {
            const serviceName = pod.metadata?.labels?.app || pod.metadata?.name;
            if (serviceName) {
              this.logger.warn(
                { serviceName, pod: pod.metadata.name },
                'Detected CrashLoopBackOff',
              );
              await this.initiateHealing('restart-service', {
                labels: {
                  alertname: 'ServiceCrashLooping',
                  service: serviceName,
                },
                annotations: {
                  summary: `Service ${serviceName} is crashlooping in ${namespace}`,
                },
                state: 'firing',
                activeAt: new Date().toISOString(),
                value: '1',
              });
            }
          }
        }
      }
    } catch (error) {
      this.logger.error(
        { error },
        'Failed to check service health via Kubernetes',
      );
    }
  }

  /**
   * Check queue depths
   */
  private async checkQueueDepths(): Promise<void> {
    const queueLength = await this.redis.zcard('task:queue');

    if (queueLength > 100) {
      this.logger.warn({ queueLength }, 'High queue depth detected');

      // Trigger scaling for the task-service if queue is backed up
      await this.initiateHealing('scale-up', {
        labels: { alertname: 'QueueBacklog', service: 'task-service' },
        annotations: {
          summary: `Task queue depth is ${queueLength}, exceeding threshold of 100`,
        },
        state: 'firing',
        activeAt: new Date().toISOString(),
        value: queueLength.toString(),
      });
    }
  }

  /**
   * Check failed tasks and trigger retries if applicable
   */
  private async checkFailedTasks(): Promise<void> {
    this.logger.debug('Checking for failed tasks to retry');

    const failedTasks = await this.prisma.task.findMany({
      where: {
        status: 'FAILED',
      },
    });

    for (const task of failedTasks) {
      const executionCount = await this.prisma.taskExecution.count({
        where: { taskId: task.id },
      });

      if (executionCount < task.maxRetries) {
        this.logger.info(
          { taskId: task.id, executionCount, maxRetries: task.maxRetries },
          'Retrying failed task',
        );

        // Reset to PENDING for re-scheduling
        await this.prisma.task.update({
          where: { id: task.id },
          data: {
            status: 'PENDING',
            nodeId: null,
            reason: `AutoHealer retry (attempt ${executionCount + 1}/${task.maxRetries})`,
          },
        });

        // Add back to queue
        await this.redis.zadd('task:queue', Date.now(), task.id);
        this.emit('task_retried', {
          taskId: task.id,
          attempt: executionCount + 1,
        });
      } else {
        this.logger.warn(
          { taskId: task.id, executionCount },
          'Task reached max retries, marking as FAILED_PERMANENT',
        );

        await this.prisma.task.update({
          where: { id: task.id },
          data: {
            status: 'FAILED_PERMANENT' as any, // Cast because Prisma might not be generated yet
            reason: 'Max retries exceeded',
          },
        });

        this.emit('task_failed_permanent', { taskId: task.id });
      }
    }
  }

  // Cooldown and storm prevention management

  private isOnCooldown(type: string, target: string): boolean {
    const key = `${type}:${target}`;
    const history = recoveryActionHistory.get(key) || [];

    // Check global cooldown
    if (Date.now() - lastGlobalRecoveryTime < GLOBAL_RECOVERY_COOLDOWN) {
      return true;
    }

    // Check per-target cooldown
    const lastAction = history[history.length - 1];
    if (lastAction && Date.now() - lastAction < this.config.cooldownMs) {
      return true;
    }

    // Check rate limits
    if (!this.checkRecoveryRateLimits(type, target)) {
      return true;
    }

    return false;
  }

  private setCooldown(type: string, target: string): void {
    const key = `${type}:${target}`;
    const history = recoveryActionHistory.get(key) || [];

    // Add timestamp to history
    history.push(Date.now());

    // Trim old entries (keep only last hour)
    const oneHourAgo = Date.now() - 3600000;
    const trimmedHistory = history.filter((t) => t > oneHourAgo);
    recoveryActionHistory.set(key, trimmedHistory);

    // Update global recovery time
    lastGlobalRecoveryTime = Date.now();
  }

  /**
   * Check if recovery rate limits are exceeded
   * Prevents recovery storms
   */
  private checkRecoveryRateLimits(type: string, target: string): boolean {
    const now = Date.now();

    // Check global rate limit (max actions per minute)
    const allRecentActions = Array.from(recoveryActionHistory.values())
      .flat()
      .filter((t) => t > now - 60000);

    if (allRecentActions.length >= MAX_RECOVERY_ACTIONS_PER_MINUTE) {
      this.logger.warn(
        {
          count: allRecentActions.length,
          limit: MAX_RECOVERY_ACTIONS_PER_MINUTE,
        },
        'Global recovery rate limit exceeded',
      );
      return false;
    }

    // Check per-service restart limit
    if (type === 'restart-service') {
      const key = `restart:${target}`;
      const history = recoveryActionHistory.get(key) || [];
      const hourlyRestarts = history.filter((t) => t > now - 3600000).length;

      if (hourlyRestarts >= MAX_RESTARTS_PER_SERVICE_PER_HOUR) {
        this.logger.warn(
          {
            service: target,
            count: hourlyRestarts,
            limit: MAX_RESTARTS_PER_SERVICE_PER_HOUR,
          },
          'Service restart rate limit exceeded',
        );
        return false;
      }
    }

    // Check bulkhead (parallel actions of same type)
    const sameTypeCount = this.activeActions.size;
    if (sameTypeCount >= RECOVERY_BULKHEAD_LIMIT) {
      this.logger.warn(
        { type, count: sameTypeCount, limit: RECOVERY_BULKHEAD_LIMIT },
        'Recovery bulkhead limit exceeded',
      );
      return false;
    }

    return true;
  }

  // Status methods
  getActiveActions(): HealingAction[] {
    return Array.from(this.activeActions.values());
  }

  getActionHistory(limit: number = 50): HealingAction[] {
    return this.actionHistory.slice(-limit);
  }

  getStats(): {
    activeActions: number;
    totalActions: number;
    actionsByType: Record<string, number>;
  } {
    const actionsByType: Record<string, number> = {};
    for (const action of this.actionHistory) {
      actionsByType[action.type] = (actionsByType[action.type] || 0) + 1;
    }

    return {
      activeActions: this.activeActions.size,
      totalActions: this.actionHistory.length,
      actionsByType,
    };
  }
}
