import { AsyncLocalStorage } from "async_hooks";

export interface LogContext {
  requestId?: string;
  traceId?: string;
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
  return storage.getStore()?.traceId;
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
): T {
  const existing = storage.getStore() || {};
  return storage.run(
    { ...existing, requestId, traceId: traceId || requestId },
    fn,
  );
}
