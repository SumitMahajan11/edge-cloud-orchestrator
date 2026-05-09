/**
 * Standard API Error Response
 * Ensures consistency across all endpoints for reliable client-side handling.
 */
export interface ApiError {
  /**
   * Machine-readable error code.
   * Examples: "TASK_NOT_FOUND", "VALIDATION_ERROR", "TOKEN_EXPIRED"
   */
  code: string;

  /**
   * Human-readable description of the error.
   */
  message: string;

  /**
   * Unique ID from the request context for support lookup and log correlation.
   */
  requestId: string;

  /**
   * ISO 8601 timestamp of when the error occurred.
   */
  timestamp: string;

  /**
   * Optional field-level validation errors or additional context.
   */
  details?: unknown;

  /**
   * Optional stack trace for development/debugging.
   * Only included when NODE_ENV is not 'production'.
   */
  stack?: string;
}
