import { AsyncLocalStorage } from 'async_hooks';

export interface LogContext {
  requestId?: string;
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
 * Run a function with just a request ID
 */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  const existing = storage.getStore() || {};
  return storage.run({ ...existing, requestId }, fn);
}
