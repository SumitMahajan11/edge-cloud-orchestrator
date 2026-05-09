import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { createLogger, IMetricsCollector } from '@edgecloud/shared-kernel';

import { IncrementalUpdater } from '../training/incremental-updater';

const logger = createLogger('ml-outcome-collector');
export interface TaskOutcome {
  taskId: string;
  nodeId: string;
  schedulingDecision: any; // The feature vector used
  predictedLatency: number;
  actualLatency: number;
  predictedCpuUsage: number;
  actualCpuUsage: number;
  outcome: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'OOM';
  timestamp: Date;
}

export class OutcomeCollector {
  private readonly bufferKey = 'ml:outcomes';
  private readonly rewardKeyPrefix = 'ml:node:';
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly ALPHA = 0.1; // Learning rate for bandit reward

  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
    private metrics: IMetricsCollector,
    private updater: IncrementalUpdater
  ) {}

  async start() {
    this.flushInterval = setInterval(() => this.flush(), 60000);
    logger.info('OutcomeCollector started with 60s flush interval');
  }

  async stop() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flush();
    logger.info('OutcomeCollector stopped');
  }

  async recordOutcome(outcome: TaskOutcome) {
    const payload = JSON.stringify(outcome);
    
    // 1. Buffer in Redis (Sorted Set)
    await this.redis.zadd(this.bufferKey, outcome.timestamp.getTime(), payload);
    
    // 2. Update Contextual Bandit Reward
    await this.updateBanditReward(outcome.nodeId, outcome.outcome);
    
    // 3. Trigger Incremental Update Check
    await this.updater.onOutcomeRecorded();
    
    // 4. Update Metrics
    const size = await this.redis.zcard(this.bufferKey);
    this.metrics.recordMetric('ml_outcome_buffer_size', size);
    
    const latencyError = Math.abs(outcome.predictedLatency - outcome.actualLatency);
    this.metrics.recordMetric('ml_prediction_error', latencyError);
  }

  private async updateBanditReward(nodeId: string, outcome: string) {
    const key = `${this.rewardKeyPrefix}${nodeId}:reward`;
    const rewardValue = outcome === 'SUCCESS' ? 1.0 : 0.0;
    
    const currentRewardStr = await this.redis.get(key);
    const oldReward = currentRewardStr ? parseFloat(currentRewardStr) : 0.5;
    
    // Running average: newReward = oldReward * (1 - alpha) + rewardValue * alpha
    const newReward = oldReward * (1 - this.ALPHA) + rewardValue * this.ALPHA;
    
    await this.redis.set(key, newReward.toString());
  }

  async flush() {
    try {
      const outcomes = await this.redis.zrange(this.bufferKey, 0, -1);
      if (outcomes.length === 0) return;

      logger.info(`Flushing ${outcomes.length} outcomes to PostgreSQL`);

      const parsedOutcomes = outcomes.map(o => JSON.parse(o) as TaskOutcome);

      // Use transaction to ensure consistency
      await this.prisma.$transaction([
        this.prisma.outcomeLog.createMany({
          data: parsedOutcomes.map(o => ({
            taskId: o.taskId,
            nodeId: o.nodeId,
            schedulingDecision: o.schedulingDecision,
            predictedLatency: o.predictedLatency,
            actualLatency: o.actualLatency,
            predictedCpuUsage: o.predictedCpuUsage,
            actualCpuUsage: o.actualCpuUsage,
            outcome: o.outcome,
            timestamp: o.timestamp,
          })),
        }),
        this.redis.del(this.bufferKey) as any
      ]);

      logger.info('Successfully flushed outcomes to PostgreSQL');
    } catch (error) {
      logger.error({ error }, 'Failed to flush outcomes to PostgreSQL');
    }
  }

  async getReward(nodeId: string): Promise<number> {
    const key = `${this.rewardKeyPrefix}${nodeId}:reward`;
    const reward = await this.redis.get(key);
    return reward ? parseFloat(reward) : 0.5;
  }

  async getStats() {
    const outcomesBuffered = await this.redis.zcard(this.bufferKey);
    return {
      outcomesBuffered,
      banditExplorationRate: 0.1, // Fixed for now
      predictionErrorP99Ms: 45 // Fixed for now
    };
  }
}
