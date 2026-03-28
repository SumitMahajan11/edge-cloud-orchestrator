/**
 * Backpressure Controller
 * 
 * Prevents system overload through:
 * - Queue depth limits
 * - Load shedding
 * - Adaptive throttling
 * - Circuit breaking at system level
 */

import Redis from 'ioredis';
import type { Logger } from 'pino';
import { EventEmitter } from 'eventemitter3';

// ============================================================================
// Types
// ============================================================================

export interface BackpressureConfig {
  maxQueueDepth: number;
  maxConcurrentTasks: number;
  maxTasksPerNode: number;
  loadShedThreshold: number; // 0-1
  throttleThreshold: number; // 0-1
  samplingWindowMs: number;
  cooldownMs: number;
}

export interface SystemLoad {
  queueDepth: number;
  concurrentTasks: number;
  avgNodeLoad: number;
  memoryUsage: number;
  cpuUsage: number;
  timestamp: Date;
}

export interface ThrottleDecision {
  shouldThrottle: boolean;
  shouldShed: boolean;
  throttleFactor: number; // 0-1, 1 = no throttle
  reason: string;
  metrics: SystemLoad;
}

type LoadLevel = 'normal' | 'elevated' | 'high' | 'critical';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: BackpressureConfig = {
  maxQueueDepth: 1000,
  maxConcurrentTasks: 100,
  maxTasksPerNode: 10,
  loadShedThreshold: 0.9,
  throttleThreshold: 0.7,
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
  private lastThrottleTime: number = 0;
  private isShedding: boolean = false;

  constructor(redis: Redis, logger: Logger, config: Partial<BackpressureConfig> = {}) {
    super();
    this.redis = redis;
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if a new task should be accepted
   */
  async shouldAcceptTask(priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'): Promise<ThrottleDecision> {
    const metrics = await this.collectMetrics();
    const decision = this.evaluate(metrics, priority);

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
    if (decision.shouldThrottle || decision.shouldShed) {
      this.logger.warn(decision, 'Backpressure triggered');
      this.emit('throttle', decision);
    }

    return decision;
  }

  /**
   * Collect current system metrics
   */
  private async collectMetrics(): Promise<SystemLoad> {
    const [queueDepth, concurrentTasks, nodeLoads] = await Promise.all([
      this.getQueueDepth(),
      this.getConcurrentTasks(),
      this.getNodeLoads(),
    ]);

    const avgNodeLoad = nodeLoads.length > 0
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
   * Evaluate throttling decision
   */
  private evaluate(metrics: SystemLoad, priority: string): ThrottleDecision {
    // Calculate normalized load score (0-1)
    const loadScore = this.calculateLoadScore(metrics);

    // Critical tasks are always accepted
    if (priority === 'CRITICAL') {
      return {
        shouldThrottle: false,
        shouldShed: false,
        throttleFactor: 1,
        reason: 'Critical priority bypasses throttling',
        metrics,
      };
    }

    // Check for load shedding
    if (loadScore >= this.config.loadShedThreshold) {
      // Only shed non-critical/non-high priority
      if (priority !== 'HIGH') {
        return {
          shouldThrottle: true,
          shouldShed: true,
          throttleFactor: 0,
          reason: `Load shedding: system at ${Math.round(loadScore * 100)}% capacity`,
          metrics,
        };
      }
    }

    // Check for throttling
    if (loadScore >= this.config.throttleThreshold) {
      const throttleFactor = 1 - ((loadScore - this.config.throttleThreshold) /
        (this.config.loadShedThreshold - this.config.throttleThreshold));

      // Apply probabilistic throttling
      if (Math.random() > throttleFactor && priority !== 'HIGH') {
        return {
          shouldThrottle: true,
          shouldShed: false,
          throttleFactor,
          reason: `Throttling: accepting ${Math.round(throttleFactor * 100)}% of requests`,
          metrics,
        };
      }
    }

    return {
      shouldThrottle: false,
      shouldShed: false,
      throttleFactor: 1,
      reason: 'Normal operation',
      metrics,
    };
  }

  /**
   * Calculate overall load score
   */
  private calculateLoadScore(metrics: SystemLoad): number {
    const weights = {
      queueDepth: 0.3,
      concurrentTasks: 0.2,
      avgNodeLoad: 0.3,
      memoryUsage: 0.2,
    };

    const normalized = {
      queueDepth: Math.min(metrics.queueDepth / this.config.maxQueueDepth, 1),
      concurrentTasks: Math.min(metrics.concurrentTasks / this.config.maxConcurrentTasks, 1),
      avgNodeLoad: metrics.avgNodeLoad,
      memoryUsage: metrics.memoryUsage,
    };

    return (
      weights.queueDepth * normalized.queueDepth +
      weights.concurrentTasks * normalized.concurrentTasks +
      weights.avgNodeLoad * normalized.avgNodeLoad +
      weights.memoryUsage * normalized.memoryUsage
    );
  }

  /**
   * Determine load level
   */
  private calculateLoadLevel(metrics: SystemLoad): LoadLevel {
    const loadScore = this.calculateLoadScore(metrics);

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
    const metrics = await this.collectMetrics();
    const loadScore = this.calculateLoadScore(metrics);

    // Reduce rate limit as load increases
    const baseRateLimit = 1000; // requests per minute
    const reductionFactor = Math.max(0.1, 1 - loadScore);

    return Math.floor(baseRateLimit * reductionFactor);
  }

  /**
   * Check if system is healthy for new connections
   */
  async canAcceptConnection(): Promise<boolean> {
    const metrics = await this.collectMetrics();
    const loadScore = this.calculateLoadScore(metrics);
    return loadScore < this.config.loadShedThreshold;
  }

  // Metrics collection helpers

  private async getQueueDepth(): Promise<number> {
    return this.redis.zcard('task:queue');
  }

  private async getConcurrentTasks(): Promise<number> {
    const running = await this.redis.get('tasks:running');
    return running ? parseInt(running, 10) : 0;
  }

  private async getNodeLoads(): Promise<number[]> {
    // In production, this would query actual node metrics
    // For now, return simulated data
    return [0.5, 0.6, 0.4];
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
}
