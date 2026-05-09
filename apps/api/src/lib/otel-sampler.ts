import {
  Sampler,
  SamplingDecision,
  SamplingResult,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import {
  Attributes,
  Context,
  Link,
  SpanKind,
} from '@opentelemetry/api';

/**
 * CompositeSampler implements the advanced sampling strategy:
 * - Always sample: requests with X-Force-Trace: true header
 * - Sample 1% of: health check endpoints
 * - Sample 10% of: normal successful requests
 * 
 * NOTE: Sampling based on 5xx errors or latency > 500ms is typically handled
 * by a Tail Sampling Processor in the OTel Collector, as the outcome 
 * is unknown at the start of the span (Head Sampling).
 */
export class CompositeSampler implements Sampler {
  private ratioSampler: TraceIdRatioBasedSampler;
  private healthCheckSampler: TraceIdRatioBasedSampler;

  constructor(ratio = 0.1, healthRatio = 0.01) {
    this.ratioSampler = new TraceIdRatioBasedSampler(ratio);
    this.healthCheckSampler = new TraceIdRatioBasedSampler(healthRatio);
  }

  shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
    links: Link[]
  ): SamplingResult {
    // 1. Check for X-Force-Trace header in attributes
    // Instrumentations often add headers to attributes
    const forceTrace = attributes['http.request.header.x_force_trace'] || 
                       attributes['x-force-trace'] ||
                       attributes['http.header.x-force-trace'];

    if (forceTrace === 'true') {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED };
    }

    // 2. Health check endpoints (sample at 1%)
    const isHealthCheck = spanName.toLowerCase().includes('health') || 
                          (attributes['http.target'] as string)?.toLowerCase().includes('health') ||
                          (attributes['http.route'] as string)?.toLowerCase().includes('health');

    if (isHealthCheck) {
      return (this.healthCheckSampler as any).shouldSample(context, traceId, spanName, spanKind, attributes, links);
    }

    // 3. Default probabilistic sampling (10%)
    return (this.ratioSampler as any).shouldSample(context, traceId, spanName, spanKind, attributes, links);
  }

  toString(): string {
    return 'CompositeSampler';
  }
}
