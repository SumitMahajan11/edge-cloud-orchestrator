// Stub tracing - no-op implementation
// TODO: Restore full OpenTelemetry tracing when dependencies are stable

export interface TracingConfig {
  serviceName: string;
  jaegerEndpoint?: string;
}

export class TracingManager {
  constructor(_config: TracingConfig) {}
  
  startSpan(_name: string, _options?: any) {
    return {
      end: () => {},
      setAttribute: (_key: string, _value: any) => {},
      recordException: (_error: Error) => {},
    };
  }
  
  shutdown() {
    return Promise.resolve();
  }
}

let tracingManager: TracingManager | null = null;

export function initializeTracing(_config: TracingConfig): TracingManager {
  if (!tracingManager) {
    tracingManager = new TracingManager(_config);
  }
  return tracingManager;
}

export function getTracingManager(): TracingManager | null {
  return tracingManager;
}
