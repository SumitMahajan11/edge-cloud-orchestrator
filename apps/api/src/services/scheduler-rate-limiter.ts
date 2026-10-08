/**
 * Scheduler Rate Limiter
 *
 * Enforces rate limits at scheduler level:
 * - Tasks per node
 * - Tasks per user
 * - Global task rate
 */

import { EventEmitter } from 'eventemitter3';
import Redis from 'ioredis';
import type { Logger } from 'pino';

// ============================================================================
// Types
// ============================================================================

export interface SchedulerRateLimitConfig {
  maxTasksPerNodePerMinute: number;
  maxTasksPerUserPerHour: number;
  maxGlobalTasksPerMinute: number;
  maxPendingTasksPerNode: number;
  maxPendingTasksGlobal: number;
  burstAllowance: number;
}

export interface RateLimitCheck {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
  currentUsage?: RateLimitUsage;
  degraded?: boolean;
}

export interface RateLimitUsage {
  globalTasksPerMinute: number;
  userTasksPerHour: number;
  nodeTasksPerMinute: number;
  pendingGlobal: number;
  pendingPerNode: Record<string, number>;
}

export interface RateLimitViolation {
  type: string;
  identifier: string;
  current: number;
  limit: number;
  timestamp: Date;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: SchedulerRateLimitConfig = {
  maxTasksPerNodePerMinute: 60,
  maxTasksPerUserPerHour: 1000,
  maxGlobalTasksPerMinute: 10000,
  maxPendingTasksPerNode: 100,
  maxPendingTasksGlobal: 5000,
  burstAllowance: 10, // Allow 10% burst over limit
};

const REDIS_KEYS = {
  globalTasksPerMinute: 'scheduler:rate:global:minute',
  userTasksPerHour: (userId: string) => `scheduler:rate:user:${userId}:hour`,
  nodeTasksPerMinute: (nodeId: string) =>
    `scheduler:rate:node:${nodeId}:minute`,
  pendingGlobal: 'scheduler:pending:global',
  pendingNode: (nodeId: string) => `scheduler:pending:node:${nodeId}`,
};

// ============================================================================
// SchedulerRateLimiter
// ============================================================================

export class SchedulerRateLimiter extends EventEmitter {
  private redis: Redis;
  private logger: Logger;
  private config: SchedulerRateLimitConfig;
  public redisAvailable = true;
  public recoveryTimer: NodeJS.Timeout | null = null;
  private fallbackNodeLogs = new Map<string, number[]>();

  constructor(
    redis: Redis,
    logger: Logger,
    config: Partial<SchedulerRateLimitConfig> = {},
  ) {
    super();
    this.redis = redis;
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if the rate limiter is in degraded mode
   */
  isDegraded(): boolean {
    return !this.redisAvailable;
  }

  /**
   * Check if a task scheduling request is allowed
   */
  /**
   * Check if a task scheduling request is allowed
   */
  async checkRateLimit(
    _taskId: string,
    userId: string,
    nodeId: string,
  ): Promise<RateLimitCheck> {
    if (!this.redisAvailable) {
      return this.checkFallbackRateLimit(nodeId);
    }

    try {
      const usage = await this.getCurrentUsage(userId, nodeId);

      // Check global rate limit
      const globalLimit =
        this.config.maxGlobalTasksPerMinute * (1 + this.config.burstAllowance);
      if (usage.globalTasksPerMinute >= globalLimit) {
        this.emit('violation', {
          type: 'global_rate',
          identifier: 'global',
          current: usage.globalTasksPerMinute,
          limit: globalLimit,
          timestamp: new Date(),
        } as RateLimitViolation);

        return {
          allowed: false,
          reason: 'Global rate limit exceeded',
          retryAfterMs: 60000 - (Date.now() % 60000),
          currentUsage: usage,
        };
      }

      // Check per-user rate limit
      const userLimit =
        this.config.maxTasksPerUserPerHour * (1 + this.config.burstAllowance);
      if (usage.userTasksPerHour >= userLimit) {
        this.emit('violation', {
          type: 'user_rate',
          identifier: userId,
          current: usage.userTasksPerHour,
          limit: userLimit,
          timestamp: new Date(),
        } as RateLimitViolation);

        return {
          allowed: false,
          reason: `User ${userId} rate limit exceeded`,
          retryAfterMs: 3600000 - (Date.now() % 3600000),
          currentUsage: usage,
        };
      }

      // Check per-node rate limit
      if (nodeId && nodeId !== 'pending') {
        const nodeLimit =
          this.config.maxTasksPerNodePerMinute * (1 + this.config.burstAllowance);
        if (usage.nodeTasksPerMinute >= nodeLimit) {
          this.emit('violation', {
            type: 'node_rate',
            identifier: nodeId,
            current: usage.nodeTasksPerMinute,
            limit: nodeLimit,
            timestamp: new Date(),
          } as RateLimitViolation);

          return {
            allowed: false,
            reason: `Node ${nodeId} rate limit exceeded`,
            retryAfterMs: 60000 - (Date.now() % 60000),
            currentUsage: usage,
          };
        }
      }

      // Check pending tasks limits
      if (usage.pendingGlobal >= this.config.maxPendingTasksGlobal) {
        return {
          allowed: false,
          reason: 'Global pending task limit exceeded',
          currentUsage: usage,
        };
      }

      if (nodeId && nodeId !== 'pending') {
        const nodePending = usage.pendingPerNode[nodeId] || 0;
        if (nodePending >= this.config.maxPendingTasksPerNode) {
          return {
            allowed: false,
            reason: `Node ${nodeId} pending task limit exceeded`,
            currentUsage: usage,
          };
        }
      }

      return {
        allowed: true,
        currentUsage: usage,
      };
    } catch (err) {
      this.logger.error(
        err,
        'Redis error in checkRateLimit, switching to fallback mode',
      );
      this.redisAvailable = false;
      this.startRecoveryCheck();
      return this.checkFallbackRateLimit(nodeId);
    }
  }

  private checkFallbackRateLimit(nodeId: string): RateLimitCheck {
    if (!nodeId || nodeId === 'pending') {
      return {
        allowed: true,
        degraded: true,
        currentUsage: {
          globalTasksPerMinute: 0,
          userTasksPerHour: 0,
          nodeTasksPerMinute: 0,
          pendingGlobal: 0,
          pendingPerNode: {},
        },
      };
    }
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    let timestamps = this.fallbackNodeLogs.get(nodeId) || [];
    timestamps = timestamps.filter((t) => t > oneMinuteAgo);

    if (timestamps.length >= 10) {
      // conservative limit of 10 tasks/min
      return {
        allowed: false,
        reason: 'Rate limit exceeded (Fallback Mode)',
        degraded: true,
        currentUsage: {
          globalTasksPerMinute: 0,
          userTasksPerHour: 0,
          nodeTasksPerMinute: timestamps.length,
          pendingGlobal: 0,
          pendingPerNode: { [nodeId]: timestamps.length },
        },
      };
    }

    // Record usage
    timestamps.push(now);
    this.fallbackNodeLogs.set(nodeId, timestamps);

    return {
      allowed: true,
      degraded: true,
      currentUsage: {
        globalTasksPerMinute: 0,
        userTasksPerHour: 0,
        nodeTasksPerMinute: timestamps.length,
        pendingGlobal: 0,
        pendingPerNode: { [nodeId]: timestamps.length },
      },
    };
  }

  private startRecoveryCheck(): void {
    if (this.recoveryTimer) {return;}

    this.recoveryTimer = setTimeout(async () => {
      try {
        await this.redis.ping();
        // Recovered!
        this.redisAvailable = true;
        this.recoveryTimer = null;
        this.logger.info('Redis connection recovered, exiting fallback mode');
      } catch (err) {
        this.recoveryTimer = null;
        this.startRecoveryCheck();
      }
    }, 5000) as any;
  }

  /**
   * Record a task scheduling event
   */
  async recordTaskScheduled(userId: string, nodeId: string): Promise<void> {
    if (!this.redisAvailable) {
      this.logger.debug(
        { userId, nodeId },
        'Bypassing Redis recordTaskScheduled in fallback mode',
      );
      return;
    }
    try {
      const now = Date.now();
      const minuteKey = Math.floor(now / 60000);
      const hourKey = Math.floor(now / 3600000);

      // Increment counters with TTL
      const pipeline = this.redis.pipeline();

      // Global per-minute counter
      pipeline.incr(`${REDIS_KEYS.globalTasksPerMinute}:${minuteKey}`);
      pipeline.expire(`${REDIS_KEYS.globalTasksPerMinute}:${minuteKey}`, 120);

      // User per-hour counter
      pipeline.incr(`${REDIS_KEYS.userTasksPerHour(userId)}:${hourKey}`);
      pipeline.expire(
        `${REDIS_KEYS.userTasksPerHour(userId)}:${hourKey}`,
        7200,
      );

      // Node per-minute counter
      pipeline.incr(`${REDIS_KEYS.nodeTasksPerMinute(nodeId)}:${minuteKey}`);
      pipeline.expire(
        `${REDIS_KEYS.nodeTasksPerMinute(nodeId)}:${minuteKey}`,
        120,
      );

      // Pending task counters
      pipeline.incr(REDIS_KEYS.pendingGlobal);
      pipeline.incr(REDIS_KEYS.pendingNode(nodeId));

      await pipeline.exec();

      this.logger.debug({ userId, nodeId }, 'Recorded task scheduling');
    } catch (err) {
      this.logger.error(
        err,
        'Redis error in recordTaskScheduled, switching to fallback mode',
      );
      this.redisAvailable = false;
      this.startRecoveryCheck();
    }
  }

  /**
   * Record task completion (decrement pending)
   */
  async recordTaskCompleted(nodeId: string): Promise<void> {
    if (!this.redisAvailable) {
      return;
    }
    try {
      const script = `
        local g = tonumber(redis.call('GET', KEYS[1]) or '0')
        if g > 0 then
          redis.call('DECR', KEYS[1])
        end
        local n = tonumber(redis.call('GET', KEYS[2]) or '0')
        if n > 0 then
          redis.call('DECR', KEYS[2])
        end
      `;
      await this.redis.eval(script, 2, REDIS_KEYS.pendingGlobal, REDIS_KEYS.pendingNode(nodeId));
    } catch (err) {
      this.logger.error(
        err,
        'Redis error in recordTaskCompleted, switching to fallback mode',
      );
      this.redisAvailable = false;
      this.startRecoveryCheck();
    }
  }

  /**
   * Reconciles pending counters against actual DB state.
   * Run periodically (e.g. every 5 minutes) to correct drift.
   */
  async reconcilePendingCounters(prisma: any): Promise<{
    before: { global: number };
    after: { global: number };
    corrected: boolean;
  }> {
    if (!this.redisAvailable) {
      return { before: { global: 0 }, after: { global: 0 }, corrected: false };
    }
    try {
      const actualPendingCount = await prisma.task.count({
        where: { status: { in: ['SCHEDULED', 'RUNNING'] } }
      });

      const currentValue = parseInt(
        (await this.redis.get(REDIS_KEYS.pendingGlobal)) || '0',
        10
      );

      const corrected = Math.abs(currentValue - actualPendingCount) > 5;
      if (corrected) {
        this.logger.warn(
          { redisValue: currentValue, actualValue: actualPendingCount },
          'Pending global counter drift detected — reconciling',
        );
        await this.redis.set(REDIS_KEYS.pendingGlobal, actualPendingCount);
      }

      // Also reconcile per-node pending counters
      try {
        const nodeCounts = await prisma.task.groupBy({
          by: ['nodeId'],
          where: {
            status: { in: ['SCHEDULED', 'RUNNING'] },
            nodeId: { not: null }
          },
          _count: { id: true }
        });

        const dbNodeMap = new Map<string, number>();
        for (const nc of nodeCounts) {
          if (nc.nodeId) {
            dbNodeMap.set(nc.nodeId, nc._count.id);
          }
        }

        const allNodes = await prisma.edgeNode.findMany({ select: { id: true } });
        const pipeline = this.redis.pipeline();
        for (const node of allNodes) {
          const actualCount = dbNodeMap.get(node.id) || 0;
          const key = REDIS_KEYS.pendingNode(node.id);
          pipeline.set(key, actualCount);
        }
        await pipeline.exec();
      } catch (err) {
        this.logger.error(err, 'Failed to reconcile per-node pending counters');
      }

      return {
        before: { global: currentValue },
        after: { global: actualPendingCount },
        corrected
      };
    } catch (err) {
      this.logger.error(err, 'Failed to reconcile pending counters');
      return { before: { global: 0 }, after: { global: 0 }, corrected: false };
    }
  }

  /**
   * Get current rate limit usage
   */
  async getCurrentUsage(
    userId: string,
    nodeId: string,
  ): Promise<RateLimitUsage> {
    const now = Date.now();
    const minuteKey = Math.floor(now / 60000);
    const hourKey = Math.floor(now / 3600000);

    const [globalMinute, userHour, nodeMinute, pendingGlobal, pendingNode] =
      await Promise.all([
        this.redis.get(`${REDIS_KEYS.globalTasksPerMinute}:${minuteKey}`),
        this.redis.get(`${REDIS_KEYS.userTasksPerHour(userId)}:${hourKey}`),
        this.redis.get(`${REDIS_KEYS.nodeTasksPerMinute(nodeId)}:${minuteKey}`),
        this.redis.get(REDIS_KEYS.pendingGlobal),
        this.redis.get(REDIS_KEYS.pendingNode(nodeId)),
      ]);

    return {
      globalTasksPerMinute: globalMinute ? parseInt(globalMinute, 10) : 0,
      userTasksPerHour: userHour ? parseInt(userHour, 10) : 0,
      nodeTasksPerMinute: nodeMinute ? parseInt(nodeMinute, 10) : 0,
      pendingGlobal: pendingGlobal ? parseInt(pendingGlobal, 10) : 0,
      pendingPerNode:
        nodeId && pendingNode ? { [nodeId]: parseInt(pendingNode, 10) } : {},
    };
  }

  /**
   * Get rate limit status for all nodes
   */
  async getNodeRateLimits(): Promise<Record<string, number>> {
    if (!this.redisAvailable) {
      const result: Record<string, number> = {};
      const now = Date.now();
      const oneMinuteAgo = now - 60000;
      for (const [nodeId, timestamps] of this.fallbackNodeLogs.entries()) {
        const activeTimestamps = timestamps.filter((t) => t > oneMinuteAgo);
        if (activeTimestamps.length > 0) {
          result[nodeId] = activeTimestamps.length;
        }
      }
      return result;
    }
    try {
      const keys = await this.redis.keys('scheduler:rate:node:*:minute:*');
      const result: Record<string, number> = {};

      for (const key of keys) {
        const match = key.match(/scheduler:rate:node:([^:]+):minute:/);
        if (match && match[1]) {
          const nodeId = match[1];
          const count = await this.redis.get(key);
          if (count) {
            result[nodeId] = parseInt(count, 10);
          }
        }
      }

      return result;
    } catch (err) {
      this.logger.error(
        err,
        'Redis error in getNodeRateLimits, switching to fallback mode',
      );
      this.redisAvailable = false;
      this.startRecoveryCheck();
      return this.getNodeRateLimits();
    }
  }

  /**
   * Reset rate limits (for testing)
   */
  async reset(): Promise<void> {
    this.redisAvailable = true;
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.fallbackNodeLogs.clear();
    const keys = await this.redis.keys('scheduler:rate:*');
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): SchedulerRateLimitConfig {
    return { ...this.config };
  }

  /**
   * Stop the rate limiter and clean up timers/listeners
   */
  stop(): void {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.removeAllListeners();
    this.logger.info('Scheduler rate limiter stopped');
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<SchedulerRateLimitConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info({ config: this.config }, 'Rate limit config updated');
  }
}
