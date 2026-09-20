import { trace } from '@opentelemetry/api';

/**
 * Return the active OpenTelemetry identifiers for structured log correlation.
 * The snake_case names match the fields used by common log aggregation tools.
 */
export function getActiveTraceContext(): Record<string, string> {
  const span = trace.getActiveSpan();
  if (!span) return {};

  const { traceId, spanId } = span.spanContext();
  return { trace_id: traceId, span_id: spanId };
}
