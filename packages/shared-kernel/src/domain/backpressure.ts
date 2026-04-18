import { BackpressureDecision, Priority, SystemLoad } from '../types/domain';

export interface BackpressureConfig {
  maxQueueDepth: number;
  maxConcurrentTasks: number;
  loadShedThreshold: number;
  throttleThreshold: number;
}

export function evaluateBackpressure(
  metrics: SystemLoad,
  priority: Priority,
  config: BackpressureConfig
): BackpressureDecision {
  const loadScore = calculateLoadScore(metrics, config);

  if (priority === 'CRITICAL') {
    return {
      shouldThrottle: false,
      shouldShed: false,
      throttleFactor: 1,
      reason: 'Critical priority bypasses throttling',
    };
  }

  if (loadScore >= config.loadShedThreshold && priority !== 'HIGH') {
    return {
      shouldThrottle: true,
      shouldShed: true,
      throttleFactor: 0,
      reason: `Load shedding: system at ${Math.round(loadScore * 100)}% capacity`,
    };
  }

  if (loadScore >= config.throttleThreshold && priority !== 'HIGH') {
    const throttleFactor = 1 - (loadScore - config.throttleThreshold) / (config.loadShedThreshold - config.throttleThreshold);
    return {
      shouldThrottle: true,
      shouldShed: false,
      throttleFactor,
      reason: `Throttling: system load at ${Math.round(loadScore * 100)}%`,
    };
  }

  return {
    shouldThrottle: false,
    shouldShed: false,
    throttleFactor: 1,
    reason: 'Normal operation',
  };
}

export function calculateLoadScore(metrics: SystemLoad, config: BackpressureConfig): number {
  const weights = {
    queueDepth: 0.4,
    concurrentTasks: 0.3,
    avgNodeLoad: 0.3,
  };

  const normalized = {
    queueDepth: Math.min(metrics.queueDepth / config.maxQueueDepth, 1),
    concurrentTasks: Math.min(metrics.concurrentTasks / config.maxConcurrentTasks, 1),
    avgNodeLoad: metrics.avgNodeLoad,
  };

  return (
    weights.queueDepth * normalized.queueDepth +
    weights.concurrentTasks * normalized.concurrentTasks +
    weights.avgNodeLoad * normalized.avgNodeLoad
  );
}
