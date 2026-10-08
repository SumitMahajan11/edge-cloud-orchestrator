/**
 * Backpressure Controller
 *
 * Prevents system overload through:
 * - Queue depth limits
 * - Load shedding
 * - Adaptive throttling
 * - Circuit breaking at system level
 */

import {
  evaluateBackpressure,
  calculateLoadScore,
  type SystemLoad as DomainSystemLoad,
  type BackpressureDecision as DomainBackpressureDecision,
  type BackpressureConfig as DomainBackpressureConfig,
  type Priority,
} from '@edgecloud/shared-kernel';
import { EventEmitter } from 'eventemitter3';
import Redis from 'ioredis';
import type { Logger } from 'pino';
import { env } from '../config/env';

// ============================================================================
// Types
// ============================================================================

export type BackpressureConfig = DomainBackpressureConfig & {
  maxTasksPerNode: number;
  samplingWindowMs: number;
  cooldownMs: number;
};

export type SystemLoad = DomainSystemLoad & {
  cpuUsage: number;
  timestamp: Date;
};

export type ThrottleDecision = DomainBackpressureDecision & {
  metrics: SystemLoad;
};

type LoadLevel = 'normal' | 'elevated' | 'high' | 'critical';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: BackpressureConfig = {
  maxQueueDepth: env.BP_MAX_QUEUE,
  maxConcurrentTasks: env.BP_MAX_CONCURRENT,
  maxTasksPerNode: 10,
  loadShedThreshold: env.BP_SHED_THRESHOLD,
  throttleThreshold: env.BP_THROTTLE_THRESHOLD,
  samplingWindowMs: 60000, // 1 minute
  cooldownMs: 5000,
};

const LOAD_THRESHOLDS: Record<LoadLevel, { min: number; max: number }> = {
  normal: { min: 0, max: 0.5 },
  elevated: { min: 0.5, max: 0.7 },
  high: { min: 0.7, max: 0.9 },
  critical: { min: 0.9, max: 1.0 },
};

// ============================================================================
// BackpressureController
// ============================================================================

export class BackpressureController extends EventEmitter {
  private redis: Redis;
  private logger: Logger;
  private config: BackpressureConfig;
  private loadHistory: SystemLoad[] = [];
  private currentLoadLevel: LoadLevel = 'normal';

  constructor(
    redis: Redis,
    logger: Logger,
    config: Partial<BackpressureConfig> = {},
  ) {
    super();
    this.redis = redis;
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the controller
   */
  async start(): Promise<void> {
    await this.refreshConfig();
    this.logger.info('Backpressure Controller started');
  }

  /**
   * Check if a new task should be accepted
   */
  async shouldAcceptTask(priority: Priority): Promise<ThrottleDecision> {
    const metrics = await this.getSystemMetrics();
    const decision = evaluateBackpressure(metrics, priority, this.config);

    // Add metrics to match original ThrottleDecision type
    const fullDecision: ThrottleDecision = { ...decision, metrics };

    // Update load level
    const newLevel = this.calculateLoadLevel(metrics);
    if (newLevel !== this.currentLoadLevel) {
      this.emit('load_level_changed', {
        from: this.currentLoadLevel,
        to: newLevel,
        metrics,
      });
      this.currentLoadLevel = newLevel;
    }

    // Log throttling decisions
    if (fullDecision.shouldThrottle || fullDecision.shouldShed) {
      this.logger.warn(fullDecision, 'Backpressure triggered');
      this.emit('throttle', fullDecision);
    }

    return fullDecision;
  }

  /**
   * Collect current system metrics
   */
  async getSystemMetrics(): Promise<SystemLoad> {
    const [queueDepth, concurrentTasks, nodeLoads] = await Promise.all([
      this.getQueueDepth(),
      this.getConcurrentTasks(),
      this.getNodeLoads(),
    ]);

    const avgNodeLoad =
      nodeLoads.length > 0
        ? nodeLoads.reduce((a, b) => a + b, 0) / nodeLoads.length
        : 0;

    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const metrics: SystemLoad = {
      queueDepth,
      concurrentTasks,
      avgNodeLoad,
      memoryUsage: memoryUsage.heapUsed / memoryUsage.heapTotal,
      cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to seconds
      timestamp: new Date(),
    };

    // Store in history
    this.loadHistory.push(metrics);
    if (this.loadHistory.length > 100) {
      this.loadHistory.shift();
    }

    return metrics;
  }

  /**
   * Helper to expose config to other services (like TaskScheduler)
   */
  getConfig(): BackpressureConfig {
    return this.config;
  }

  /**
   * Determine load level
   */
  private calculateLoadLevel(metrics: SystemLoad): LoadLevel {
    const loadScore = calculateLoadScore(metrics, this.config);

    for (const [level, { min, max }] of Object.entries(LOAD_THRESHOLDS)) {
      if (loadScore >= min && loadScore < max) {
        return level as LoadLevel;
      }
    }

    return 'critical';
  }

  /**
   * Get adaptive rate limit based on current load
   */
  async getAdaptiveRateLimit(): Promise<number> {
    const metrics = await this.getSystemMetrics();
    const loadScore = calculateLoadScore(metrics, this.config);

    // Reduce rate limit as load increases
    const baseRateLimit = 1000; // requests per minute
    const reductionFactor = Math.max(0.1, 1 - loadScore);

    return Math.floor(baseRateLimit * reductionFactor);
  }

  /**
   * Check if system is healthy for new connections
   */
  async canAcceptConnection(): Promise<boolean> {
    const metrics = await this.getSystemMetrics();
    const loadScore = calculateLoadScore(metrics, this.config);
    return loadScore < this.config.loadShedThreshold;
  }

  /**
   * Pull configuration from Redis or fallback to default
   */
  async refreshConfig(): Promise<void> {
    try {
      const persisted = await this.redis.get('config:backpressure');
      if (persisted) {
        this.config = { ...this.config, ...JSON.parse(persisted) };
        this.logger.debug(
          { config: this.config },
          'Backpressure config refreshed from Redis',
        );
      }
    } catch (error) {
      this.logger.error({ error }, 'Failed to refresh backpressure config');
    }
  }

  /**
   * Persist current config to Redis
   */
  async persistConfig(config: Partial<BackpressureConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
    await this.redis.set('config:backpressure', JSON.stringify(this.config));
    this.logger.info(
      { config: this.config },
      'Backpressure config persisted to Redis',
    );
  }

  private async getQueueDepth(): Promise<number> {
    try {
      return await this.redis.zcard('task:queue');
    } catch {
      return 0;
    }
  }

  private async getConcurrentTasks(): Promise<number> {
    try {
      const running = await this.redis.get('tasks:running');
      return running ? parseInt(running, 10) : 0;
    } catch {
      return 0;
    }
  }

  private async getNodeLoads(): Promise<number[]> {
    try {
      // Find all node metric keys
      const keys = await this.redis.keys('node:*:metrics');
      if (!keys || keys.length === 0) {return [];}

      const loads: number[] = [];
      for (const key of keys) {
        const metrics = await this.redis.hgetall(key);
        if (metrics && metrics.cpuUsage) {
          // Normalize 0-100 to 0-1
          loads.push(parseFloat(metrics.cpuUsage) / 100);
        }
      }
      return loads;
    } catch (error) {
      this.logger.error({ error }, 'Failed to fetch node loads from Redis');
      return [];
    }
  }

  // Status methods

  getCurrentLoadLevel(): LoadLevel {
    return this.currentLoadLevel;
  }

  getLoadHistory(): SystemLoad[] {
    return [...this.loadHistory];
  }

  getStats(): {
    currentLevel: LoadLevel;
    historyLength: number;
    config: BackpressureConfig;
  } {
    return {
      currentLevel: this.currentLoadLevel,
      historyLength: this.loadHistory.length,
      config: this.config,
    };
  }

  /**
   * Stop the backpressure controller and remove listeners
   */
  stop(): void {
    this.removeAllListeners();
    this.logger.info('Backpressure controller stopped');
  }
}
