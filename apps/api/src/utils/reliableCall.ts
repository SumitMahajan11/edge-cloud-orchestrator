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
import axios, { AxiosError, type AxiosResponse } from 'axios';

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
  cause?: Error | undefined;
  statusCode?: number | undefined;
  attemptCount?: number | undefined;

  constructor(
    message: string,
    cause?: Error,
    statusCode?: number,
    attemptCount?: number,
  ) {
    super(message);
    this.name = 'ReliableCallError';
    this.cause = cause;
    this.statusCode = statusCode;
    this.attemptCount = attemptCount;
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
    maxAttempts: settings.retries! + 1,
    initialDelay: 1000,
    maxDelay: settings.timeoutMs! / 2,
    backoffMultiplier: 2,
    jitterType: 'full',
    shouldRetry: (err) => isRetryableError(err, settings.retryableStatusCodes),
  });

  let lastError: Error | undefined;
  let attemptCount = 0;

  const executeWithReliability = async () => {
    return await retryPolicy.execute(async (context) => {
      attemptCount = context.attempt;

      // Execute with timeout
      let timeoutId: NodeJS.Timeout;
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () =>
              reject(
                new TimeoutError(settings.operationName!, settings.timeoutMs!),
              ),
            settings.timeoutMs,
          );
        }),
      ]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });

      return result;
    });
  };

  try {
    if (settings.circuitBreaker) {
      return await settings.circuitBreaker.execute(executeWithReliability);
    }
    return await executeWithReliability();
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
export function isRetryableError(
  error: unknown,
  retryableStatusCodes: number[] = [408, 429, 500, 502, 503, 504],
): boolean {
  if (!error) return false;

  const err = error as any;

  // Network errors are retryable
  const message = err.message || '';
  if (
    message.includes('ECONNRESET') ||
    message.includes('ETIMEDOUT') ||
    message.includes('ENOTFOUND') ||
    message.includes('ECONNREFUSED') ||
    message.includes('EPIPE')
  ) {
    return true;
  }

  // HTTP status codes
  if (axios.isAxiosError(error) || err.response?.status || err.status) {
    const status = err.response?.status || err.status;
    if (status && retryableStatusCodes.includes(status)) {
      return true;
    }
  }

  // Timeout errors are NOT retryable (we set the timeout)
  if (error instanceof TimeoutError) {
    return false;
  }

  return false;
}
