import {
  SamplingDecision,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import type {
  Sampler,
  SamplingResult,
} from '@opentelemetry/sdk-trace-base';
import { SpanKind } from '@opentelemetry/api';
import type {
  Attributes,
  Context,
  Link,
} from '@opentelemetry/api';

/**
 * CompositeSampler for the Web frontend.
 */
export class CompositeSampler implements Sampler {
  private ratioSampler: TraceIdRatioBasedSampler;

  constructor(ratio = 0.1) {
    this.ratioSampler = new TraceIdRatioBasedSampler(ratio);
  }

  shouldSample(
    context: Context,
    traceId: string,
    _spanName: string,
    _spanKind: SpanKind,
    attributes: Attributes,
    _links: Link[]
  ): SamplingResult {
    // 1. Force trace for debugging
    if (attributes['x-force-trace'] === 'true') {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED };
    }

    // 2. Default 10% sampling
    // Note: TraceIdRatioBasedSampler.shouldSample expects only 2 args in this SDK version.
    return this.ratioSampler.shouldSample(context, traceId);
  }

  toString(): string {
    return 'WebCompositeSampler';
  }
}
