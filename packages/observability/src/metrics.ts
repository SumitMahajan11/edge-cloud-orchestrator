// Stub MetricsCollector - no-op implementation
// TODO: Restore full Prometheus metrics when observability package is stable

export interface MetricsConfig {
  serviceName: string;
  serviceVersion?: string;
  port?: number;
}

export class MetricsCollector {
  constructor(_config: MetricsConfig) {}
  
  recordGauge(_name: string, _value: number, _labels?: Record<string, string>) {}
  recordCounter(_name: string, _value: number, _labels?: Record<string, string>) {}
  recordHistogram(_name: string, _value: number, _labels?: Record<string, string>) {}
  recordMLFallback(_reason: string, _fallback: string) {}
  recordSchedulingDecision(_type: string, _status: string, _duration: number) {}
  updateMLDrift(_version: string, _mae: number) {}
  
  startMetricsServer() {
    return Promise.resolve();
  }
}

// Stub instance for type compatibility with ml-scheduler
export const metricsCollector = new MetricsCollector({ serviceName: 'stub' });
