/**
 * Graceful Degradation Strategy
 * 
 * Provides graceful degradation under system stress:
 * - Disables ML scoring when load is high
 * - Switches to simpler algorithms
 * - Reduces feature set progressively
 */

import type { Logger } from 'pino';
import { EventEmitter } from 'eventemitter3';

// ============================================================================
// Types
// ============================================================================

export type DegradationLevel = 'normal' | 'degraded' | 'minimal' | 'critical';

export interface DegradationConfig {
  mlThreshold: number;      // CPU/memory threshold to disable ML
  cacheThreshold: number;   // Threshold to reduce caching
  featureThreshold: number; // Threshold to disable non-critical features
  checkIntervalMs: number;
}

export interface FeatureState {
  name: string;
  enabled: boolean;
  degradationLevel: DegradationLevel;
  fallbackMode: string;
}

export interface SystemHealth {
  cpuUsage: number;
  memoryUsage: number;
  latency: number;
  errorRate: number;
  queueDepth: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: DegradationConfig = {
  mlThreshold: 0.8,
  cacheThreshold: 0.9,
  featureThreshold: 0.95,
  checkIntervalMs: 5000,
};

const DEGRADATION_FEATURES: Record<DegradationLevel, string[]> = {
  normal: ['all'],
  degraded: ['ml-scoring', 'advanced-analytics', 'real-time-metrics'],
  minimal: ['real-time-updates', 'websocket', 'caching', 'batch-operations'],
  critical: ['scheduling', 'task-execution'], // Only critical path
};

// ============================================================================
// GracefulDegradationService
// ============================================================================

export class GracefulDegradationService extends EventEmitter {
  private logger: Logger;
  private config: DegradationConfig;
  private currentLevel: DegradationLevel = 'normal';
  private featureStates: Map<string, FeatureState> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private lastHealth: SystemHealth | null = null;

  constructor(logger: Logger, config: Partial<DegradationConfig> = {}) {
    super();
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeFeatures();
  }

  /**
   * Initialize feature states
   */
  private initializeFeatures(): void {
    const features = [
      { name: 'ml-scoring', fallbackMode: 'round-robin' },
      { name: 'advanced-analytics', fallbackMode: 'basic-metrics' },
      { name: 'real-time-metrics', fallbackMode: 'cached-metrics' },
      { name: 'real-time-updates', fallbackMode: 'polling' },
      { name: 'websocket', fallbackMode: 'http-polling' },
      { name: 'caching', fallbackMode: 'direct-db' },
      { name: 'batch-operations', fallbackMode: 'single-ops' },
      { name: 'scheduling', fallbackMode: 'critical-only' },
      { name: 'task-execution', fallbackMode: 'essential-only' },
    ];

    for (const feature of features) {
      this.featureStates.set(feature.name, {
        name: feature.name,
        enabled: true,
        degradationLevel: 'normal',
        fallbackMode: feature.fallbackMode,
      });
    }
  }

  /**
   * Start monitoring
   */
  start(): void {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      this.checkAndDegrade();
    }, this.config.checkIntervalMs);

    this.logger.info('Graceful degradation monitoring started');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check system health and adjust degradation level
   */
  private async checkAndDegrade(): Promise<void> {
    const health = await this.getSystemHealth();
    this.lastHealth = health;

    const newLevel = this.calculateDegradationLevel(health);

    if (newLevel !== this.currentLevel) {
      this.logger.warn(
        { from: this.currentLevel, to: newLevel, health },
        'Degradation level changing'
      );

      this.emit('degradation', {
        from: this.currentLevel,
        to: newLevel,
        health,
        timestamp: new Date(),
      });

      this.currentLevel = newLevel;
      this.applyDegradation(newLevel);
    }
  }

  /**
   * Calculate degradation level based on health
   */
  private calculateDegradationLevel(health: SystemHealth): DegradationLevel {
    // Calculate composite stress score
    const stressScore = (
      health.cpuUsage * 0.3 +
      health.memoryUsage * 0.3 +
      Math.min(health.latency / 1000, 1) * 0.2 +
      health.errorRate * 0.2
    );

    if (stressScore >= this.config.featureThreshold) {
      return 'critical';
    } else if (stressScore >= this.config.cacheThreshold) {
      return 'minimal';
    } else if (stressScore >= this.config.mlThreshold) {
      return 'degraded';
    }

    return 'normal';
  }

  /**
   * Apply degradation level to features
   */
  private applyDegradation(level: DegradationLevel): void {
    const disabledFeatures = DEGRADATION_FEATURES[level];

    for (const [name, state] of this.featureStates) {
      const shouldDisable = disabledFeatures.length > 0 &&
        !disabledFeatures.includes('all') &&
        disabledFeatures.includes(name);

      state.enabled = !shouldDisable;
      state.degradationLevel = level;

      if (shouldDisable) {
        this.logger.info(
          { feature: name, fallback: state.fallbackMode },
          'Feature degraded'
        );
        this.emit('feature-degraded', { feature: name, fallback: state.fallbackMode });
      }
    }
  }

  /**
   * Get current system health
   */
  private async getSystemHealth(): Promise<SystemHealth> {
    const memoryUsage = process.memoryUsage();
    
    // In production, these would come from metrics service
    return {
      cpuUsage: 0, // Would get from metrics
      memoryUsage: memoryUsage.heapUsed / memoryUsage.heapTotal,
      latency: 100, // Would get from recent request metrics
      errorRate: 0, // Would get from error tracking
      queueDepth: 0, // Would get from queue metrics
    };
  }

  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(featureName: string): boolean {
    const state = this.featureStates.get(featureName);
    if (!state) return true; // Unknown features pass through
    return state.enabled;
  }

  /**
   * Get fallback mode for a feature
   */
  getFallbackMode(featureName: string): string | null {
    const state = this.featureStates.get(featureName);
    if (!state || state.enabled) return null;
    return state.fallbackMode;
  }

  /**
   * Get current degradation level
   */
  getCurrentLevel(): DegradationLevel {
    return this.currentLevel;
  }

  /**
   * Get all feature states
   */
  getFeatureStates(): FeatureState[] {
    return Array.from(this.featureStates.values());
  }

  /**
   * Get last health check
   */
  getLastHealth(): SystemHealth | null {
    return this.lastHealth;
  }

  /**
   * Execute with fallback
   * If feature is disabled, use fallback implementation
   */
  async executeWithFallback<T>(
    featureName: string,
    primaryFn: () => Promise<T>,
    fallbackFn: () => Promise<T>
  ): Promise<T> {
    if (this.isFeatureEnabled(featureName)) {
      return primaryFn();
    }

    this.logger.debug(
      { feature: featureName },
      'Using fallback implementation'
    );
    return fallbackFn();
  }

  /**
   * Get scheduling algorithm to use
   */
  getSchedulingAlgorithm(): 'ml' | 'weighted' | 'round-robin' {
    if (this.isFeatureEnabled('ml-scoring')) {
      return 'ml';
    }

    if (this.currentLevel === 'critical') {
      return 'round-robin';
    }

    return 'weighted';
  }

  /**
   * Get metrics refresh strategy
   */
  getMetricsStrategy(): 'real-time' | 'cached' | 'minimal' {
    if (this.isFeatureEnabled('real-time-metrics')) {
      return 'real-time';
    }

    if (this.currentLevel === 'critical') {
      return 'minimal';
    }

    return 'cached';
  }

  /**
   * Manually set degradation level (for testing)
   */
  setLevel(level: DegradationLevel): void {
    this.currentLevel = level;
    this.applyDegradation(level);
  }
}
