import { AsyncLocalStorage } from "async_hooks";
import { trace, context } from "@opentelemetry/api";

export interface LogContext {
  requestId?: string;
  traceId?: string;
  trace_id?: string;
  spanId?: string;
  span_id?: string;
  [key: string]: any;
}

const storage = new AsyncLocalStorage<LogContext>();

/**
 * Get the current request ID from context
 */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Get the current trace ID from context
 */
export function getTraceId(): string | undefined {
  const store = storage.getStore();
  if (store?.trace_id) {return store.trace_id;}
  if (store?.traceId) {return store.traceId;}
  const spanContext = (trace.getSpan(context.active()) || trace.getActiveSpan())?.spanContext();
  return spanContext?.traceId;
}

/**
 * Get active OpenTelemetry trace context fields (trace_id, span_id, traceId, spanId).
 * Fallback: returns empty object (omits fields) if no active span or valid trace context exists.
 */
export function getActiveTraceContext(): Record<string, string> {
  const activeSpan = trace.getSpan(context.active()) || trace.getActiveSpan();
  if (activeSpan) {
    const spanContext = activeSpan.spanContext();
    if (
      spanContext &&
      spanContext.traceId &&
      spanContext.traceId !== "00000000000000000000000000000000" &&
      spanContext.spanId &&
      spanContext.spanId !== "0000000000000000"
    ) {
      return {
        trace_id: spanContext.traceId,
        span_id: spanContext.spanId,
      };
    }
  }

  const store = storage.getStore();
  if (store) {
    const result: Record<string, string> = {};
    const traceId = store.trace_id || store.traceId;
    const spanId = store.span_id || store.spanId;
    if (traceId) {
      result.trace_id = traceId;
    }
    if (spanId) {
      result.span_id = spanId;
    }
    return result;
  }

  return {};
}

/**
 * Injects trace_id and span_id from the active OTel context into a given log record object.
 * Fallback: omits trace fields if no active span is present.
 */
export function injectTraceContextToLog<T extends Record<string, any>>(record: T = {} as T): T {
  const traceCtx = getActiveTraceContext();
  const requestId = getRequestId();
  return {
    ...record,
    ...traceCtx,
    ...(requestId && !record.requestId ? { requestId } : {}),
  };
}

/**
 * Get the full log context
 */
export function getLogContext(): LogContext | undefined {
  return storage.getStore();
}

/**
 * Run a function within a specific log context
 */
export function runWithContext<T>(context: LogContext, fn: () => T): T {
  return storage.run(context, fn);
}

/**
 * Run a function with just a request ID and optionally trace ID
 */
export function runWithRequestId<T>(
  requestId: string,
  traceId: string | undefined,
  fn: () => T,
  spanId?: string,
): T {
  const existing = storage.getStore() || {};
  const tid = traceId || requestId;
  return storage.run(
    {
      ...existing,
      requestId,
      trace_id: tid,
      ...(spanId ? { span_id: spanId } : {}),
    },
    fn,
  );
}

