import {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { apiErrorsTotal } from '../services/metrics-service';
import { env } from '../config/env';

/**
 * Global Error Handler Plugin
 * Standardizes all API errors into the ApiError schema and records metrics.
 */
export const globalErrorHandler = (
  error: FastifyError | (Error & { statusCode?: number; code?: string }),
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  process.stdout.write(`[errorHandler] ENTERED with error: ${error.message} code: ${error.code} statusCode: ${error.statusCode}\n`);
  let statusCode = error.statusCode || 500;
  let code = error.code || 'INTERNAL_ERROR';
  let message = error.message || 'An unexpected error occurred';
  let details: unknown = undefined;

  // --- Mapping Logic ---

  // 1. Zod Validation Errors
  if (error instanceof ZodError || error.name === 'ZodError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed';
    details = (error as any).errors.map((e: any) => ({
      path: e.path.join('.'),
      message: e.message,
      code: e.code,
    }));
  }

  // 2. Prisma Database Errors
  else if (error.name === 'PrismaClientKnownRequestError') {
    const prismaError = error as any;
    switch (prismaError.code) {
      case 'P2025': // Not found
        statusCode = 404;
        code = 'RESOURCE_NOT_FOUND';
        message = 'The requested resource was not found';
        break;
      case 'P2002': // Unique constraint violation
        statusCode = 409;
        code = 'RESOURCE_CONFLICT';
        message = 'A resource with this identifier already exists';
        details = { target: (error as any).meta?.target };
        break;
      default:
        statusCode = 500;
        code = 'DATABASE_ERROR';
        message = 'A database error occurred';
    }
  }

  // 3. Authentication & Authorization Errors
  else if (error.message?.includes('jwt') || error.message?.includes('token')) {
    statusCode = 401;
    if (error.message.includes('expired')) {
      code = 'TOKEN_EXPIRED';
      message = 'Your session has expired. Please log in again.';
    } else {
      code = 'TOKEN_INVALID';
      message = 'Invalid authentication token provided.';
    }
  } 
  else if (statusCode === 403 || error.message?.includes('permission')) {
    statusCode = 403;
    code = 'FORBIDDEN';
    message = 'You do not have permission to perform this action.';
  }

  // 4. Rate Limiting
  else if (statusCode === 429) {
    code = 'RATE_LIMIT_EXCEEDED';
    message = 'Too many requests. Please try again later.';
  }

  // 5. Explicit Fastify/Custom Errors
  else if (error.code === 'FST_ERR_VALIDATION') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
  }

  // Final sanitization for production
  if (statusCode === 500 && env.NODE_ENV === 'production') {
    message = 'An internal server error occurred';
  }

  const errorResponse = {
    error: {
      code,
      message,
      requestId: (request.headers['x-request-id'] as string) || request.id as string,
      timestamp: new Date().toISOString(),
      details,
      ...(env.NODE_ENV !== 'production' && { stack: error.stack }),
    }
  };

  // Record Metrics
  const route = request.routeOptions?.url || request.url;
  apiErrorsTotal.labels(code, route, request.method).inc();

  // Log Error
  request.log.error({
    msg: 'API Error',
    requestId: request.id,
    code,
    statusCode,
    error: {
      message: error.message,
      stack: error.stack,
    },
  });

  return reply.status(statusCode).send(errorResponse);
};

export const errorHandler = fp(async (fastify: FastifyInstance) => {
  process.stdout.write('[errorHandler plugin] INITIALIZING...\n');
  fastify.setErrorHandler(globalErrorHandler);
});

export default errorHandler;
