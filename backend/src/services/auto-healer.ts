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

import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import type { Logger } from 'pino';
import { EventEmitter } from 'eventemitter3';
import axios from 'axios';

// ============================================================================
// Types
// ============================================================================

export interface HealingAction {
  id: string;
  type: 'reschedule-tasks' | 'restart-service' | 'scale-up' | 'scale-down' | 'clear-queue';
  target: string;
  reason: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  metadata?: Record<string, unknown>;
}

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
  cooldownMs: 60000, // 1 minute cooldown between actions
  maxConcurrentActions: 5,
  enableKubernetesActions: true,
  kubernetesNamespace: 'default',
  prometheusUrl: 'http://prometheus:9090',
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

  constructor(
    prisma: PrismaClient,
    redis: Redis,
    logger: Logger,
    config: Partial<AutoHealerConfig> = {}
  ) {
    super();
    this.prisma = prisma;
    this.redis = redis;
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the auto-healer
   */
  start(): void {
    // Subscribe to alert channel
    this.subscribeToAlerts();

    // Periodic health check
    this.alertCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, 30000);

    this.logger.info('Auto-healer started');
    this.emit('started');
  }

  /**
   * Stop the auto-healer
   */
  stop(): void {
    if (this.alertCheckInterval) {
      clearInterval(this.alertCheckInterval);
      this.alertCheckInterval = null;
    }

    this.logger.info('Auto-healer stopped');
    this.emit('stopped');
  }

  /**
   * Subscribe to Redis alert channel
   */
  private subscribeToAlerts(): void {
    const subscriber = this.redis.duplicate();
    subscriber.subscribe('alerts:prometheus', 'alerts:custom');

    subscriber.on('message', (channel, message) => {
      try {
        const alert = JSON.parse(message);
        this.handleAlert(alert);
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
      const alertName = a.labels.alertname || 'unknown';
      const actionType = this.determineActionType(a);

      if (actionType) {
        await this.initiateHealing(actionType, a);
      }
    }
  }

  /**
   * Determine healing action from alert
   */
  private determineActionType(alert: AlertPayload['alerts'][0]): HealingAction['type'] | null {
    const alertName = alert.labels.alertname || '';
    const severity = alert.labels.severity || '';

    // Map alerts to actions
    const alertActionMap: Record<string, HealingAction['type']> = {
      'NodeDown': 'reschedule-tasks',
      'NodeUnreachable': 'reschedule-tasks',
      'HighNodeLoad': 'scale-up',
      'ServiceCrashLooping': 'restart-service',
      'ServiceNotReady': 'restart-service',
      'HighMemoryUsage': 'scale-up',
      'KafkaConsumerLag': 'scale-up',
      'QueueBacklog': 'scale-up',
      'DeadlockDetected': 'restart-service',
    };

    if (alertActionMap[alertName]) {
      return alertActionMap[alertName];
    }

    // Check severity for critical issues
    if (severity === 'critical') {
      return 'restart-service';
    }

    return null;
  }

  /**
   * Initiate a healing action
   */
  async initiateHealing(
    type: HealingAction['type'],
    alert: AlertPayload['alerts'][0]
  ): Promise<HealingAction | null> {
    const target = alert.labels.instance || alert.labels.service || alert.labels.node || 'unknown';
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
      reason: alert.annotations.summary || alert.annotations.description || 'Alert triggered',
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

    this.logger.info({ nodeId, taskCount: tasks.length }, 'Found tasks to reschedule');

    for (const task of tasks) {
      // Reset task to PENDING
      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          nodeId: null,
          status: 'PENDING',
          reason: `Rescheduled due to node ${nodeId} failure`,
        },
      });

      // Add back to queue
      await this.redis.zadd(
        'task:queue',
        Date.now(),
        task.id
      );

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
      // Use kubectl to restart deployment
      const { exec } = require('child_process');
      const namespace = this.config.kubernetesNamespace;

      await new Promise<void>((resolve, reject) => {
        exec(
          `kubectl rollout restart deployment/${serviceName} -n ${namespace}`,
          (error: Error | null, stdout: string, stderr: string) => {
            if (error) {
              reject(new Error(`Failed to restart: ${stderr}`));
            } else {
              resolve();
            }
          }
        );
      });

      this.emit('service_restarted', { serviceName });
    } catch (error) {
      this.logger.error({ error, serviceName }, 'Failed to restart service');
      throw error;
    }
  }

  /**
   * Scale a service
   */
  private async scaleService(serviceName: string, delta: number): Promise<void> {
    if (!this.config.enableKubernetesActions) {
      this.logger.warn('Kubernetes actions disabled, skipping scale');
      return;
    }

    this.logger.info({ serviceName, delta }, 'Scaling service');

    try {
      const { exec } = require('child_process');
      const namespace = this.config.kubernetesNamespace;

      await new Promise<void>((resolve, reject) => {
        exec(
          `kubectl scale deployment/${serviceName} --replicas=$(kubectl get deployment ${serviceName} -n ${namespace} -o jsonpath='{.spec.replicas}')${delta > 0 ? '+1' : '-1'} -n ${namespace}`,
          (error: Error | null, stdout: string, stderr: string) => {
            if (error) {
              reject(new Error(`Failed to scale: ${stderr}`));
            } else {
              resolve();
            }
          }
        );
      });

      this.emit('service_scaled', { serviceName, delta });
    } catch (error) {
      this.logger.error({ error, serviceName }, 'Failed to scale service');
      throw error;
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
   * Perform periodic health checks
   */
  private async performHealthChecks(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
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
    // This would check Kubernetes pod health
    // For now, we rely on Prometheus alerts
  }

  /**
   * Check queue depths
   */
  private async checkQueueDepths(): Promise<void> {
    const queueLength = await this.redis.zcard('task:queue');

    if (queueLength > 100) {
      this.logger.warn({ queueLength }, 'High queue depth detected');
      // Could trigger scaling here
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
    const trimmedHistory = history.filter(t => t > oneHourAgo);
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
      .filter(t => t > now - 60000);
    
    if (allRecentActions.length >= MAX_RECOVERY_ACTIONS_PER_MINUTE) {
      this.logger.warn(
        { count: allRecentActions.length, limit: MAX_RECOVERY_ACTIONS_PER_MINUTE },
        'Global recovery rate limit exceeded'
      );
      return false;
    }
    
    // Check per-service restart limit
    if (type === 'restart-service') {
      const key = `restart:${target}`;
      const history = recoveryActionHistory.get(key) || [];
      const hourlyRestarts = history.filter(t => t > now - 3600000).length;
      
      if (hourlyRestarts >= MAX_RESTARTS_PER_SERVICE_PER_HOUR) {
        this.logger.warn(
          { service: target, count: hourlyRestarts, limit: MAX_RESTARTS_PER_SERVICE_PER_HOUR },
          'Service restart rate limit exceeded'
        );
        return false;
      }
    }
    
    // Check bulkhead (parallel actions of same type)
    const sameTypeCount = this.activeActions.size;
    if (sameTypeCount >= RECOVERY_BULKHEAD_LIMIT) {
      this.logger.warn(
        { type, count: sameTypeCount, limit: RECOVERY_BULKHEAD_LIMIT },
        'Recovery bulkhead limit exceeded'
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
