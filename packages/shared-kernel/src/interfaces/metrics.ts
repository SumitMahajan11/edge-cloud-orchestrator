export interface IMetricsCollector {
  recordMLFallback(reason: string, fallback: string): void;
  recordSchedulingDecision(
    type: string,
    status: string,
    duration: number,
  ): void;
  updateMLDrift(version: string, mae: number): void;
  recordMetric(
    name: string,
    value: number,
    labels?: Record<string, string>,
  ): void;
  recordCarbonMetrics(carbonGco2: number, savedGco2: number): void;
}
