export interface ApiErrorResponse {
  code: string;
  message: string;
  requestId: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export class ApiClientError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly response: ApiErrorResponse,
    public readonly requestId?: string,
  ) {
    super(response.message);
    this.name = "ApiClientError";
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }
  isUnauthorized(): boolean {
    return this.statusCode === 401;
  }
  isForbidden(): boolean {
    return this.statusCode === 403;
  }
  isConflict(): boolean {
    return this.statusCode === 409;
  }
  isServerError(): boolean {
    return this.statusCode >= 500;
  }
}

export function isApiClientError(e: unknown): e is ApiClientError {
  return e instanceof ApiClientError;
}
