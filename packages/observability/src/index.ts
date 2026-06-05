export { MetricsCollector, type MetricsConfig } from "./metrics";
export { initTracing } from "./tracing";

// Stub metrics collector for use by packages that need type compatibility
export const metricsCollectorStub = {
  recordGauge: () => {},
  recordCounter: () => {},
  recordMLFallback: (_reason: string, _fallback: string) => {},
  recordSchedulingDecision: (
    _type: string,
    _status: string,
    _duration: number,
  ) => {},
  updateMLDrift: (_version: string, _mae: number) => {},
};
