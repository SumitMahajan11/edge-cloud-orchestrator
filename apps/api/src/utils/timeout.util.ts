/**
 * Timeout Utility for HTTP Requests
 *
 * Prevents hanging requests by enforcing timeouts on all external calls.
 * Works with both fetch and axios.
 */

// ============================================================================
// Types
// ============================================================================

export interface TimeoutOptions {
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Operation name for error message */
  operationName?: string;
  /** AbortSignal (for fetch) */
  signal?: AbortSignal;
}

export class TimeoutError extends Error {
  public readonly operationName: string;
  public readonly timeoutMs: number;

  constructor(
    operationName: string,
    timeoutMs: number,
  ) {
    super(`${operationName} timed out after ${timeoutMs}ms`);
    this.operationName = operationName;
    this.timeoutMs = timeoutMs;
    this.name = 'TimeoutError';
  }
}

// ============================================================================
// Timeout Wrapper for Promises
// ============================================================================

/**
 * Wrap any promise with a timeout
 *
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param operationName - Name of the operation for error messages
 * @returns Promise that rejects with TimeoutError if timeout is exceeded
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string = 'Operation',
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          reject(new TimeoutError(operationName, timeoutMs));
        });
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// Fetch with Timeout
// ============================================================================

/**
 * Fetch wrapper with automatic timeout
 *
 * @param url - URL to fetch
 * @param options - Fetch options including timeout
 * @returns Response from fetch
 *
 * @example
 * const response = await fetchWithTimeout('/api/tasks', {
 *   timeoutMs: 5000,
 *   method: 'POST',
 *   body: JSON.stringify(data)
 * });
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 10000, ...fetchOptions } = options;

  // Create abort controller
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    return response;
  } catch (error) {
    if ((error as any).name === 'AbortError') {
      throw new TimeoutError(`GET ${url}`, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// Axios-like Helper
// ============================================================================

/**
 * Axios request configuration
 */
export interface AxiosRequestConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  data?: any;
  headers?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
}

/**
 * Axios response wrapper
 */
export interface AxiosResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: any;
}

/**
 * Execute axios-like request with timeout
 * Note: This creates an AbortSignal that can be passed to axios
 *
 * @param config - Request configuration
 * @param timeoutMs - Timeout in milliseconds
 * @returns Object with signal that should be passed to axios
 *
 * @example
 * const { signal } = createTimeoutSignal(5000);
 * const response = await axios.get(url, { signal });
 */
export function createTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Auto-clear timeout when request completes
  const cleanup = () => clearTimeout(timeoutId);
  controller.signal.addEventListener('abort', cleanup);

  return { signal: controller.signal };
}

// ============================================================================
// Default Timeouts by Operation Type
// ============================================================================

export const DEFAULT_TIMEOUTS = {
  // Fast operations
  HEALTH_CHECK: 3000, // 3 seconds
  PING: 2000, // 2 seconds

  // Standard API calls
  API_REQUEST: 10000, // 10 seconds
  DATABASE_QUERY: 15000, // 15 seconds

  // Long-running operations
  FILE_UPLOAD: 60000, // 60 seconds
  TASK_EXECUTION: 300000, // 5 minutes
  WORKFLOW_EXECUTION: 600000, // 10 minutes

  // External services
  EXTERNAL_API: 30000, // 30 seconds
  WEBHOOK: 15000, // 15 seconds
} as const;
