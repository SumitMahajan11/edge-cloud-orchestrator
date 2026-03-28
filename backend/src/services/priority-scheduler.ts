/**
 * Priority-Based Task Scheduler
 * 
 * Implements weighted priority execution:
 * - HIGH priority: 60% of capacity
 * - MEDIUM priority: 30% of capacity
 * - LOW priority: 10% of capacity (best effort)
 * 
 * Prevents starvation through priority aging
 */

import Redis from 'ioredis';
import type { Logger } from 'pino';
import { EventEmitter } from 'eventemitter3';

// ============================================================================
// Types
// ============================================================================

export type TaskPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface PriorityTask {
  id: string;
  priority: TaskPriority;
  payload: Record<string, unknown>;
  createdAt: Date;
  deadline?: Date;
  estimatedDuration?: number; // seconds
  nodeId?: string;
  userId: string;
  agingBoost: number; // Increases over time to prevent starvation
}

export interface PriorityQueue {
  name: TaskPriority;
  weight: number; // Percentage of capacity (0-1)
  maxWaitTimeMs: number;
  agingRate: number; // Boost per second waiting
}

export interface ScheduleResult {
  taskId: string;
  priority: TaskPriority;
  scheduledAt: Date;
  estimatedStart: Date;
  position: number;
}

export interface PriorityStats {
  queueDepths: Record<TaskPriority, number>;
  avgWaitTimes: Record<TaskPriority, number>;
  processedCounts: Record<TaskPriority, number>;
  starvedTasks: number;
}

// ============================================================================
// Constants
// ============================================================================

const PRIORITY_QUEUES: Record<TaskPriority, PriorityQueue> = {
  CRITICAL: {
    name: 'CRITICAL',
    weight: 0.5, // 50% of capacity (bypasses normal scheduling)
    maxWaitTimeMs: 0, // Immediate
    agingRate: 0,
  },
  HIGH: {
    name: 'HIGH',
    weight: 0.35, // 35% of normal capacity
    maxWaitTimeMs: 30000, // 30s max wait
    agingRate: 0.1, // 10% boost per second
  },
  MEDIUM: {
    name: 'MEDIUM',
    weight: 0.12, // 12% of normal capacity
    maxWaitTimeMs: 120000, // 2min max wait
    agingRate: 0.05, // 5% boost per second
  },
  LOW: {
    name: 'LOW',
    weight: 0.03, // 3% of normal capacity (best effort)
    maxWaitTimeMs: 600000, // 10min max wait
    agingRate: 0.02, // 2% boost per second
  },
};

const REDIS_KEYS = {
  queue: (priority: TaskPriority) => `priority:queue:${priority}`,
  task: (taskId: string) => `priority:task:${taskId}`,
  stats: (priority: TaskPriority) => `priority:stats:${priority}`,
  aging: 'priority:aging',
};

// ============================================================================
// PriorityScheduler
// ============================================================================

export class PriorityScheduler extends EventEmitter {
  private redis: Redis;
  private logger: Logger;
  private isRunning: boolean = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private agingInterval: NodeJS.Timeout | null = null;

  constructor(redis: Redis, logger: Logger) {
    super();
    this.redis = redis;
    this.logger = logger;
  }

  /**
   * Start the priority scheduler
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;

    // Start aging process (every 5 seconds)
    this.agingInterval = setInterval(() => {
      this.applyAging();
    }, 5000);

    this.logger.info('Priority scheduler started');
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    this.isRunning = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    if (this.agingInterval) {
      clearInterval(this.agingInterval);
      this.agingInterval = null;
    }

    this.logger.info('Priority scheduler stopped');
  }

  /**
   * Submit a task to the priority queue
   */
  async submitTask(task: Omit<PriorityTask, 'agingBoost'>): Promise<ScheduleResult> {
    const priority = task.priority;
    const fullTask: PriorityTask = {
      ...task,
      agingBoost: 0,
    };

    // Calculate effective priority score
    const score = this.calculatePriorityScore(fullTask);

    // Add to priority queue (sorted set)
    await this.redis.zadd(
      REDIS_KEYS.queue(priority),
      score,
      JSON.stringify(fullTask)
    );

    // Store task details
    await this.redis.setex(
      REDIS_KEYS.task(task.id),
      86400,
      JSON.stringify(fullTask)
    );

    // Update stats
    await this.redis.hincrby(REDIS_KEYS.stats(priority), 'submitted', 1);

    // Get position in queue
    const position = await this.redis.zrank(
      REDIS_KEYS.queue(priority),
      JSON.stringify(fullTask)
    );

    this.logger.debug(
      { taskId: task.id, priority, score, position },
      'Task submitted to priority queue'
    );

    // Emit event for immediate processing if CRITICAL
    if (priority === 'CRITICAL') {
      this.emit('critical-task', fullTask);
    }

    return {
      taskId: task.id,
      priority,
      scheduledAt: new Date(),
      estimatedStart: this.estimateStartTime(priority, position || 0),
      position: (position || 0) + 1,
    };
  }

  /**
   * Get next batch of tasks to execute
   * Respects priority weights to prevent starvation
   */
  async getNextBatch(batchSize: number = 10): Promise<PriorityTask[]> {
    const tasks: PriorityTask[] = [];
    let remainingSlots = batchSize;

    // 1. Always process CRITICAL first (bypasses weights)
    const criticalTasks = await this.redis.zrange(
      REDIS_KEYS.queue('CRITICAL'),
      0,
      batchSize - 1
    );

    for (const taskJson of criticalTasks) {
      const task: PriorityTask = JSON.parse(taskJson);
      tasks.push(task);
      await this.redis.zrem(REDIS_KEYS.queue('CRITICAL'), taskJson);
    }

    const remainingAfterCritical = batchSize - tasks.length;
    if (remainingAfterCritical <= 0) return tasks;

    // 2. Calculate slots per priority based on weights
    const slots = {
      HIGH: Math.floor(remainingAfterCritical * PRIORITY_QUEUES.HIGH.weight),
      MEDIUM: Math.floor(remainingAfterCritical * PRIORITY_QUEUES.MEDIUM.weight),
      LOW: Math.max(1, Math.floor(remainingAfterCritical * PRIORITY_QUEUES.LOW.weight)),
    };

    // 3. Process HIGH priority
    const highTasks = await this.redis.zrange(
      REDIS_KEYS.queue('HIGH'),
      0,
      slots.HIGH - 1
    );

    for (const taskJson of highTasks) {
      const task: PriorityTask = JSON.parse(taskJson);
      tasks.push(task);
      await this.redis.zrem(REDIS_KEYS.queue('HIGH'), taskJson);
    }

    // 4. Process MEDIUM priority
    const mediumTasks = await this.redis.zrange(
      REDIS_KEYS.queue('MEDIUM'),
      0,
      slots.MEDIUM - 1
    );

    for (const taskJson of mediumTasks) {
      const task: PriorityTask = JSON.parse(taskJson);
      tasks.push(task);
      await this.redis.zrem(REDIS_KEYS.queue('MEDIUM'), taskJson);
    }

    // 5. Process LOW priority (fill remaining slots)
    const remainingSlots2 = batchSize - tasks.length;
    if (remainingSlots2 > 0) {
      const lowTasks = await this.redis.zrange(
        REDIS_KEYS.queue('LOW'),
        0,
        remainingSlots2 - 1
      );

      for (const taskJson of lowTasks) {
        const task: PriorityTask = JSON.parse(taskJson);
        tasks.push(task);
        await this.redis.zrem(REDIS_KEYS.queue('LOW'), taskJson);
      }
    }

    // Update stats
    for (const task of tasks) {
      await this.redis.hincrby(REDIS_KEYS.stats(task.priority), 'processed', 1);
    }

    return tasks;
  }

  /**
   * Apply aging to prevent starvation
   * Increases priority score of waiting tasks
   */
  private async applyAging(): Promise<void> {
    const priorities: TaskPriority[] = ['HIGH', 'MEDIUM', 'LOW'];

    for (const priority of priorities) {
      const queue = PRIORITY_QUEUES[priority];
      const tasks = await this.redis.zrange(
        REDIS_KEYS.queue(priority),
        0,
        -1,
        'WITHSCORES'
      );

      for (let i = 0; i < tasks.length; i += 2) {
        const taskJson = tasks[i];
        const currentScore = parseFloat(tasks[i + 1]);
        const task: PriorityTask = JSON.parse(taskJson);

        // Calculate aging boost
        const waitTimeMs = Date.now() - new Date(task.createdAt).getTime();
        const waitTimeSeconds = waitTimeMs / 1000;
        const agingBoost = waitTimeSeconds * queue.agingRate;

        // Update task with new boost
        task.agingBoost = agingBoost;
        const newScore = this.calculatePriorityScore(task);

        // Update in queue
        await this.redis.zadd(
          REDIS_KEYS.queue(priority),
          newScore,
          JSON.stringify(task)
        );

        // Check for starvation
        if (waitTimeMs > queue.maxWaitTimeMs) {
          this.emit('starvation-warning', {
            taskId: task.id,
            priority,
            waitTimeMs,
          });
        }
      }
    }
  }

  /**
   * Calculate priority score (lower = higher priority)
   */
  private calculatePriorityScore(task: PriorityTask): number {
    const baseScores: Record<TaskPriority, number> = {
      CRITICAL: 0,
      HIGH: 100,
      MEDIUM: 200,
      LOW: 300,
    };

    const baseScore = baseScores[task.priority];
    const agingPenalty = -task.agingBoost * 10; // Negative to increase priority
    const deadlinePenalty = this.calculateDeadlinePenalty(task);

    return baseScore + agingPenalty + deadlinePenalty;
  }

  /**
   * Calculate deadline penalty (negative = higher priority)
   */
  private calculateDeadlinePenalty(task: PriorityTask): number {
    if (!task.deadline) return 0;

    const now = Date.now();
    const deadline = new Date(task.deadline).getTime();
    const timeUntilDeadline = deadline - now;

    if (timeUntilDeadline < 0) {
      return -1000; // Overdue - maximum priority
    }

    if (timeUntilDeadline < 60000) {
      return -500; // Less than 1 minute
    }

    if (timeUntilDeadline < 300000) {
      return -200; // Less than 5 minutes
    }

    return 0;
  }

  /**
   * Estimate start time for a task
   */
  private estimateStartTime(priority: TaskPriority, position: number): Date {
    const avgProcessingTime = 5000; // 5 seconds per task
    const estimatedWaitMs = position * avgProcessingTime;
    return new Date(Date.now() + estimatedWaitMs);
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<PriorityStats> {
    const priorities: TaskPriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    const queueDepths: Record<TaskPriority, number> = {} as Record<TaskPriority, number>;
    const processedCounts: Record<TaskPriority, number> = {} as Record<TaskPriority, number>;

    for (const priority of priorities) {
      const depth = await this.redis.zcard(REDIS_KEYS.queue(priority));
      queueDepths[priority] = depth;

      const stats = await this.redis.hgetall(REDIS_KEYS.stats(priority));
      processedCounts[priority] = parseInt(stats.processed || '0', 10);
    }

    // Calculate average wait times
    const avgWaitTimes: Record<TaskPriority, number> = {} as Record<TaskPriority, number>;
    for (const priority of priorities) {
      const tasks = await this.redis.zrange(
        REDIS_KEYS.queue(priority),
        0,
        -1
      );

      if (tasks.length === 0) {
        avgWaitTimes[priority] = 0;
        continue;
      }

      let totalWait = 0;
      for (const taskJson of tasks) {
        const task: PriorityTask = JSON.parse(taskJson);
        totalWait += Date.now() - new Date(task.createdAt).getTime();
      }

      avgWaitTimes[priority] = totalWait / tasks.length;
    }

    // Count starved tasks
    let starvedTasks = 0;
    for (const priority of priorities) {
      const queue = PRIORITY_QUEUES[priority];
      const tasks = await this.redis.zrange(
        REDIS_KEYS.queue(priority),
        0,
        -1
      );

      for (const taskJson of tasks) {
        const task: PriorityTask = JSON.parse(taskJson);
        const waitTime = Date.now() - new Date(task.createdAt).getTime();
        if (waitTime > queue.maxWaitTimeMs) {
          starvedTasks++;
        }
      }
    }

    return {
      queueDepths,
      avgWaitTimes,
      processedCounts,
      starvedTasks,
    };
  }

  /**
   * Promote a task to higher priority
   */
  async promoteTask(taskId: string, newPriority: TaskPriority): Promise<boolean> {
    const taskJson = await this.redis.get(REDIS_KEYS.task(taskId));
    if (!taskJson) return false;

    const task: PriorityTask = JSON.parse(taskJson);
    const oldPriority = task.priority;

    // Remove from old queue
    await this.redis.zrem(REDIS_KEYS.queue(oldPriority), taskJson);

    // Update priority
    task.priority = newPriority;
    task.agingBoost = 0;

    // Add to new queue
    const score = this.calculatePriorityScore(task);
    await this.redis.zadd(
      REDIS_KEYS.queue(newPriority),
      score,
      JSON.stringify(task)
    );

    // Update stored task
    await this.redis.setex(
      REDIS_KEYS.task(taskId),
      86400,
      JSON.stringify(task)
    );

    this.logger.info(
      { taskId, from: oldPriority, to: newPriority },
      'Task priority promoted'
    );

    return true;
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const taskJson = await this.redis.get(REDIS_KEYS.task(taskId));
    if (!taskJson) return false;

    const task: PriorityTask = JSON.parse(taskJson);

    // Remove from queue
    await this.redis.zrem(REDIS_KEYS.queue(task.priority), taskJson);

    // Delete task record
    await this.redis.del(REDIS_KEYS.task(taskId));

    this.logger.info({ taskId }, 'Task cancelled');

    return true;
  }
}
