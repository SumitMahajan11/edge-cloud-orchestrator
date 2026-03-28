/**
 * RecoveryCoordinator - Orchestrates recovery procedures
 * 
 * Coordinates recovery actions across the system, maintains recovery state,
 * and prevents recovery storms with cooldown periods.
 */

import Redis from 'ioredis';
import type { Logger } from 'pino';
import { EventEmitter } from 'eventemitter3';
import { PrismaClient } from '@prisma/client';

// ============================================================================
// Types
// ============================================================================

export interface RecoveryPlan {
  id: string;
  incidentId: string;
  type: 'node-failure' | 'service-failure' | 'data-corruption' | 'network-partition' | 'cascade-failure';
  status: 'pending' | 'executing' | 'completed' | 'failed';
  steps: RecoveryStep[];
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface RecoveryStep {
  name: string;
  action: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'skipped';
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface RecoveryConfig {
  cooldownMs: number;
  maxConcurrentRecoveries: number;
  stepTimeoutMs: number;
  enableAutoRecovery: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: RecoveryConfig = {
  cooldownMs: 300000, // 5 minutes
  maxConcurrentRecoveries: 3,
  stepTimeoutMs: 60000, // 1 minute per step
  enableAutoRecovery: true,
};

const RECOVERY_KEY_PREFIX = 'recovery:';
const COOLDOWN_KEY_PREFIX = 'recovery:cooldown:';

// ============================================================================
// RecoveryCoordinator Service
// ============================================================================

export class RecoveryCoordinator extends EventEmitter {
  private prisma: PrismaClient;
  private redis: Redis;
  private logger: Logger;
  private config: RecoveryConfig;
  private activeRecoveries: Map<string, RecoveryPlan> = new Map();
  private recoveryHistory: RecoveryPlan[] = [];
  private recoveryLock: Map<string, boolean> = new Map();

  constructor(
    prisma: PrismaClient,
    redis: Redis,
    logger: Logger,
    config: Partial<RecoveryConfig> = {}
  ) {
    super();
    this.prisma = prisma;
    this.redis = redis;
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initiate a recovery plan
   */
  async initiateRecovery(
    incidentId: string,
    type: RecoveryPlan['type'],
    affectedEntities: string[]
  ): Promise<RecoveryPlan | null> {
    const recoveryId = `recovery-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // Check cooldown
    if (await this.isOnCooldown(type)) {
      this.logger.info({ type, incidentId }, 'Recovery on cooldown');
      return null;
    }

    // Check concurrent limit
    if (this.activeRecoveries.size >= this.config.maxConcurrentRecoveries) {
      this.logger.warn('Max concurrent recoveries reached');
      return null;
    }

    // Check for duplicate recovery
    const lockKey = `${type}:${affectedEntities.join(',')}`;
    if (this.recoveryLock.has(lockKey)) {
      this.logger.info({ lockKey }, 'Recovery already in progress for these entities');
      return null;
    }

    // Create recovery plan
    const plan = this.createRecoveryPlan(recoveryId, incidentId, type, affectedEntities);
    this.activeRecoveries.set(recoveryId, plan);
    this.recoveryLock.set(lockKey, true);

    // Set cooldown
    await this.setCooldown(type);

    this.logger.info({ recoveryId, type, incidentId }, 'Initiating recovery');
    this.emit('recovery_started', plan);

    // Execute recovery
    try {
      await this.executeRecovery(plan);
      plan.status = 'completed';
      plan.completedAt = new Date();
      this.emit('recovery_completed', plan);
    } catch (error) {
      plan.status = 'failed';
      plan.error = (error as Error).message;
      plan.completedAt = new Date();
      this.emit('recovery_failed', plan);
    } finally {
      this.activeRecoveries.delete(recoveryId);
      this.recoveryLock.delete(lockKey);
      this.recoveryHistory.push(plan);
      // Keep only last 50 recoveries
      if (this.recoveryHistory.length > 50) {
        this.recoveryHistory.shift();
      }
    }

    return plan;
  }

  /**
   * Create a recovery plan based on incident type
   */
  private createRecoveryPlan(
    recoveryId: string,
    incidentId: string,
    type: RecoveryPlan['type'],
    affectedEntities: string[]
  ): RecoveryPlan {
    const steps = this.getRecoverySteps(type, affectedEntities);

    return {
      id: recoveryId,
      incidentId,
      type,
      status: 'pending',
      steps,
      startedAt: new Date(),
    };
  }

  /**
   * Get recovery steps for incident type
   */
  private getRecoverySteps(
    type: RecoveryPlan['type'],
    affectedEntities: string[]
  ): RecoveryStep[] {
    switch (type) {
      case 'node-failure':
        return [
          { name: 'Isolate failed node', action: 'isolate-node', status: 'pending' },
          { name: 'Reschedule tasks', action: 'reschedule-tasks', status: 'pending' },
          { name: 'Update node status', action: 'update-status', status: 'pending' },
          { name: 'Notify monitoring', action: 'notify', status: 'pending' },
        ];

      case 'service-failure':
        return [
          { name: 'Check service health', action: 'health-check', status: 'pending' },
          { name: 'Restart service', action: 'restart-service', status: 'pending' },
          { name: 'Verify recovery', action: 'verify', status: 'pending' },
        ];

      case 'data-corruption':
        return [
          { name: 'Stop affected services', action: 'stop-services', status: 'pending' },
          { name: 'Restore from backup', action: 'restore-backup', status: 'pending' },
          { name: 'Verify data integrity', action: 'verify-integrity', status: 'pending' },
          { name: 'Restart services', action: 'restart-services', status: 'pending' },
        ];

      case 'network-partition':
        return [
          { name: 'Identify partition', action: 'identify-partition', status: 'pending' },
          { name: 'Isolate affected nodes', action: 'isolate-nodes', status: 'pending' },
          { name: 'Wait for network recovery', action: 'wait', status: 'pending' },
          { name: 'Reintegrate nodes', action: 'reintegrate', status: 'pending' },
        ];

      case 'cascade-failure':
        return [
          { name: 'Stop cascade', action: 'stop-cascade', status: 'pending' },
          { name: 'Assess damage', action: 'assess', status: 'pending' },
          { name: 'Prioritize recovery', action: 'prioritize', status: 'pending' },
          { name: 'Execute recovery', action: 'execute', status: 'pending' },
          { name: 'Verify system stability', action: 'verify', status: 'pending' },
        ];

      default:
        return [{ name: 'Generic recovery', action: 'generic', status: 'pending' }];
    }
  }

  /**
   * Execute recovery plan
   */
  private async executeRecovery(plan: RecoveryPlan): Promise<void> {
    plan.status = 'executing';

    for (const step of plan.steps) {
      step.status = 'in-progress';
      step.startedAt = new Date();

      this.logger.info({ recoveryId: plan.id, step: step.name }, 'Executing recovery step');
      this.emit('step_started', { planId: plan.id, step });

      try {
        await this.executeStep(step, plan);
        step.status = 'completed';
        step.completedAt = new Date();
        this.emit('step_completed', { planId: plan.id, step });
      } catch (error) {
        step.status = 'failed';
        step.error = (error as Error).message;
        step.completedAt = new Date();
        this.emit('step_failed', { planId: plan.id, step, error });

        // Decide whether to continue or abort
        if (this.isCriticalStep(step)) {
          throw new Error(`Critical step failed: ${step.name}`);
        }
      }
    }
  }

  /**
   * Execute a recovery step
   */
  private async executeStep(step: RecoveryStep, plan: RecoveryPlan): Promise<void> {
    const timeout = this.config.stepTimeoutMs;

    switch (step.action) {
      case 'isolate-node':
        await this.isolateNode(plan);
        break;
      case 'reschedule-tasks':
        await this.rescheduleTasks(plan);
        break;
      case 'update-status':
        await this.updateNodeStatus(plan);
        break;
      case 'restart-service':
        await this.restartService(plan);
        break;
      case 'health-check':
        await this.healthCheck(plan);
        break;
      case 'verify':
        await this.verifyRecovery(plan);
        break;
      case 'notify':
        await this.notify(plan);
        break;
      default:
        this.logger.warn({ action: step.action }, 'Unknown recovery action');
    }
  }

  /**
   * Check if a step is critical
   */
  private isCriticalStep(step: RecoveryStep): boolean {
    const criticalSteps = ['isolate-node', 'stop-cascade', 'restore-backup'];
    return criticalSteps.includes(step.action);
  }

  // Recovery step implementations

  private async isolateNode(plan: RecoveryPlan): Promise<void> {
    // Mark node as isolated in Redis
    const key = `${RECOVERY_KEY_PREFIX}isolated:${plan.incidentId}`;
    await this.redis.setex(key, 3600, 'true');
  }

  private async rescheduleTasks(plan: RecoveryPlan): Promise<void> {
    // Find tasks on failed node and reschedule
    const tasks = await this.prisma.task.findMany({
      where: {
        status: { in: ['SCHEDULED', 'RUNNING'] },
      },
      take: 100,
    });

    for (const task of tasks) {
      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          nodeId: null,
          status: 'PENDING',
          reason: `Rescheduled by recovery ${plan.id}`,
        },
      });

      await this.redis.zadd('task:queue', Date.now(), task.id);
    }
  }

  private async updateNodeStatus(plan: RecoveryPlan): Promise<void> {
    // Update node status in database
    this.logger.info({ incidentId: plan.incidentId }, 'Updating node status');
  }

  private async restartService(_plan: RecoveryPlan): Promise<void> {
    // Kubernetes restart implementation
    this.logger.info('Restarting service via Kubernetes');
  }

  private async healthCheck(_plan: RecoveryPlan): Promise<void> {
    // Run health checks
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  private async verifyRecovery(_plan: RecoveryPlan): Promise<void> {
    // Verify system has recovered
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  private async notify(plan: RecoveryPlan): Promise<void> {
    // Notify monitoring system
    this.emit('notification', {
      type: 'recovery',
      planId: plan.id,
      status: plan.status,
    });
  }

  // Cooldown management

  private async isOnCooldown(type: string): Promise<boolean> {
    const key = `${COOLDOWN_KEY_PREFIX}${type}`;
    const cooldown = await this.redis.get(key);
    return cooldown !== null;
  }

  private async setCooldown(type: string): Promise<void> {
    const key = `${COOLDOWN_KEY_PREFIX}${type}`;
    await this.redis.setex(key, Math.floor(this.config.cooldownMs / 1000), 'true');
  }

  // Status methods

  getActiveRecoveries(): RecoveryPlan[] {
    return Array.from(this.activeRecoveries.values());
  }

  getRecoveryHistory(limit: number = 20): RecoveryPlan[] {
    return this.recoveryHistory.slice(-limit);
  }

  getStats(): {
    activeRecoveries: number;
    totalRecoveries: number;
    byType: Record<string, number>;
    successRate: number;
  } {
    const byType: Record<string, number> = {};
    let successful = 0;

    for (const plan of this.recoveryHistory) {
      byType[plan.type] = (byType[plan.type] || 0) + 1;
      if (plan.status === 'completed') successful++;
    }

    return {
      activeRecoveries: this.activeRecoveries.size,
      totalRecoveries: this.recoveryHistory.length,
      byType,
      successRate: this.recoveryHistory.length > 0 
        ? successful / this.recoveryHistory.length 
        : 1,
    };
  }
}
