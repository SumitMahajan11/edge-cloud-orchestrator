// ============================================================================
// Reliable Service Call Layer
// ============================================================================
//
// Combines retry, circuit breaker, timeout, and safe execution
// for all external service calls.
//
// Usage:
//   const result = await reliableCall(() => axios.get(url));
// ============================================================================

import { RetryPolicy } from '@edgecloud/circuit-breaker';
import type { CircuitBreaker } from '@edgecloud/circuit-breaker';
import axios, { AxiosError, AxiosResponse } from 'axios';

export interface ReliableCallConfig {
  retries?: number;
  timeoutMs?: number;
  circuitBreaker?: CircuitBreaker | undefined;
  retryableStatusCodes?: number[];
  operationName?: string;
}

const DEFAULT_CONFIG: Omit<ReliableCallConfig, 'circuitBreaker'> & {
  circuitBreaker: undefined;
} = {
  retries: 3,
  timeoutMs: 5000,
  circuitBreaker: undefined,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  operationName: 'unknown',
};

export class ReliableCallError extends Error {
  constructor(
    message: string,
    public cause?: Error,
    public statusCode?: number,
    public attemptCount?: number,
  ) {
    super(message);
    this.name = 'ReliableCallError';
  }
}

export class TimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Execute a function with reliability patterns:
 * - Retry with exponential backoff
 * - Circuit breaker integration
 * - Timeout protection
 * - Error classification
 *
 * @param fn - Function to execute (should return Promise)
 * @param config - Reliability configuration
 * @returns Result of the function call
 *
 * @example
 * ```typescript
 * // Basic usage
 * const response = await reliableCall(() => axios.get('/api/tasks'));
 *
 * // With custom config
 * const response = await reliableCall(
 *   () => axios.post('/api/external', data),
 *   { retries: 5, timeoutMs: 10000, operationName: 'external-api-call' }
 * );
 *
 * // With circuit breaker
 * const response = await reliableCall(
 *   () => axios.get('/api/service'),
 *   { circuitBreaker: myCircuitBreaker }
 * );
 * ```
 */
export async function reliableCall<T>(
  fn: () => Promise<T>,
  config: ReliableCallConfig = {},
): Promise<T> {
  const settings = {
    retries: config.retries ?? DEFAULT_CONFIG.retries,
    timeoutMs: config.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
    circuitBreaker: config.circuitBreaker,
    retryableStatusCodes:
      config.retryableStatusCodes ?? DEFAULT_CONFIG.retryableStatusCodes,
    operationName: config.operationName ?? DEFAULT_CONFIG.operationName,
  };

  // Create retry policy
  const retryPolicy = new RetryPolicy({
    maxAttempts: settings.retries!,
    initialDelay: 1000,
    maxDelay: settings.timeoutMs! / 2,
    backoffMultiplier: 2,
    jitterType: 'full',
    circuitBreaker: settings.circuitBreaker,
    retryableErrors: (settings.retryableStatusCodes || []).map(
      (code) => `HTTP_${code}`,
    ),
  });

  let lastError: Error | undefined;
  let attemptCount = 0;

  try {
    return await retryPolicy.execute(async (context) => {
      attemptCount = context.attempt;

      // Execute with timeout
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new TimeoutError(settings.operationName!, settings.timeoutMs!),
              ),
            settings.timeoutMs,
          ),
        ),
      ]);

      return result;
    });
  } catch (error) {
    lastError = error as Error;

    // Extract status code if axios error
    let statusCode: number | undefined;
    if (axios.isAxiosError(error)) {
      statusCode = (error as AxiosError).response?.status;
    }

    throw new ReliableCallError(
      `Failed after ${attemptCount} attempts: ${lastError.message}`,
      lastError,
      statusCode,
      attemptCount,
    );
  }
}

/**
 * Wrapper for axios calls with built-in reliability
 */
export async function reliableAxios<T>(
  url: string,
  options?: any,
  config?: ReliableCallConfig,
): Promise<AxiosResponse<T>> {
  return reliableCall(() => axios.get<T>(url, options), {
    ...config,
    operationName: config?.operationName || `GET ${url}`,
  });
}

/**
 * Wrapper for fetch calls with built-in reliability
 */
export async function reliableFetch<T>(
  url: string,
  options?: RequestInit,
  config?: ReliableCallConfig,
): Promise<T> {
  return reliableCall(
    () =>
      fetch(url, options).then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return res.json() as Promise<T>;
      }),
    { ...config, operationName: config?.operationName || `FETCH ${url}` },
  );
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  const err = error as Error;

  // Network errors are retryable
  if (
    err.message.includes('ECONNRESET') ||
    err.message.includes('ETIMEDOUT') ||
    err.message.includes('ENOTFOUND')
  ) {
    return true;
  }

  // HTTP status codes
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    return (
      status === 408 ||
      status === 429 ||
      (!!status && status >= 500 && status <= 599)
    );
  }

  // Timeout errors are NOT retryable (we set the timeout)
  if (error instanceof TimeoutError) {
    return false;
  }

  return false;
}
