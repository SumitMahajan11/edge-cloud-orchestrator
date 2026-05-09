import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { IMetricsCollector } from '@edgecloud/shared-kernel';

export interface MetricsConfig {
  serviceName: string;
  serviceVersion?: string;
  port?: number;
  prefix?: string;
}

export class MetricsCollector implements IMetricsCollector {
  private registry: Registry;
  private mlFallbackTotal: Counter;
  private mlDriftMae: Gauge;
  private schedulingDecisionsTotal: Counter;
  private gauges: Map<string, Gauge> = new Map();
  private histograms: Map<string, Histogram> = new Map();

  constructor(config: MetricsConfig) {
    this.registry = new Registry();
    const prefix = config.prefix || 'edgecloud_';
    
    collectDefaultMetrics({ register: this.registry, prefix: `${prefix}${config.serviceName.replace(/-/g, '_')}_` });

    this.mlFallbackTotal = new Counter({
      name: `${prefix}ml_fallback_total`,
      help: 'Total number of times ML scheduling fell back to rule-based logic',
      labelNames: ['reason', 'fallback_strategy'],
      registers: [this.registry],
    });

    this.mlDriftMae = new Gauge({
      name: `${prefix}ml_drift_mae`,
      help: 'Mean Absolute Error of the active ML model as reported by drift detector',
      labelNames: ['model_version'],
      registers: [this.registry],
    });

    this.gauges.set('ml_bandit_explore_rate', new Gauge({
      name: `${prefix}ml_bandit_explore_rate`,
      help: 'Current exploration rate of the contextual bandit',
      registers: [this.registry],
    }));
    this.gauges.get('ml_bandit_explore_rate')!.set(0.1);

    this.gauges.set('ml_outcome_buffer_size', new Gauge({
      name: `${prefix}ml_outcome_buffer_size`,
      help: 'Number of outcomes waiting to be flushed to database',
      registers: [this.registry],
    }));

    this.gauges.set('ml_model_last_updated_timestamp', new Gauge({
      name: `${prefix}ml_model_last_updated_timestamp`,
      help: 'Timestamp of the last incremental model update',
      registers: [this.registry],
    }));

    this.gauges.set('ml_prediction_error_p99', new Gauge({
      name: `${prefix}ml_prediction_error_p99`,
      help: 'Rolling p99 of |predicted - actual| latency',
      registers: [this.registry],
    }));

    this.gauges.set('scheduling_carbon_gco2_per_task', new Gauge({
      name: `${prefix}scheduling_carbon_gco2_per_task`,
      help: 'Estimated carbon per scheduled task (gCO2)',
      registers: [this.registry],
    }));

    this.gauges.set('scheduling_carbon_saved_gco2', new Gauge({
      name: `${prefix}scheduling_carbon_saved_gco2`,
      help: 'Carbon saved vs naive (fastest-first) scheduling (gCO2)',
      registers: [this.registry],
    }));

    this.histograms.set('ml_prediction_error', new Histogram({
      name: `${prefix}ml_prediction_error`,
      help: 'Latency prediction error (|predicted - actual|)',
      buckets: [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5],
      registers: [this.registry],
    }));

    this.schedulingDecisionsTotal = new Counter({
      name: `${prefix}scheduling_decisions_total`,
      help: 'Total number of scheduling decisions made',
      labelNames: ['type', 'status'],
      registers: [this.registry],
    });
  }
  
  recordMLFallback(reason: string, fallback: string) {
    this.mlFallbackTotal.labels(reason, fallback).inc();
  }

  recordSchedulingDecision(type: string, status: string, duration: number) {
    this.schedulingDecisionsTotal.labels(type, status).inc();
    // In a real app we'd also record duration to a histogram
  }

  updateMLDrift(version: string, mae: number) {
    this.mlDriftMae.labels(version).set(mae);
  }

  recordMetric(name: string, value: number, labels?: Record<string, string>) {
    const gauge = this.gauges.get(name);
    if (gauge) {
      if (labels) {
        gauge.labels(labels).set(value);
      } else {
        gauge.set(value);
      }
      return;
    }

    const histogram = this.histograms.get(name);
    if (histogram) {
      if (labels) {
        histogram.labels(labels).observe(value);
      } else {
        histogram.observe(value);
      }
      return;
    }
  }

  recordCarbonMetrics(carbonGco2: number, savedGco2: number) {
    this.recordMetric('scheduling_carbon_gco2_per_task', carbonGco2);
    this.recordMetric('scheduling_carbon_saved_gco2', savedGco2);
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}

// Global instance for convenience if needed
export const metricsCollector = new MetricsCollector({ serviceName: 'global' });
