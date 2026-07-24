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
  process.stdout.write(
    `[errorHandler] ENTERED with error: ${error.message} code: ${error.code} statusCode: ${error.statusCode}\n`,
  );
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
  else if (error.name?.startsWith('PrismaClient') || error.constructor?.name?.startsWith('PrismaClient')) {
    const prismaError = error as any;
    
    // Handle database cold-start / connection issues gracefully
    if (prismaError.name === 'PrismaClientInitializationError' || ['P1001', 'P1011', 'P1012', 'P1017', 'P1008'].includes(prismaError.code)) {
      if (request.method === 'GET') {
        request.log.warn({
          msg: 'Database cold start or connection issue, returning graceful empty response',
          error: prismaError.message,
          code: prismaError.code
        });
        return reply.status(200).send(getGracefulEmptyResponse(request));
      } else {
        statusCode = 503;
        code = 'SERVICE_UNAVAILABLE';
        message = 'The database is currently starting up or unavailable. Please try again in a few seconds.';
      }
    } else {
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
        details = {
          prismaCode: prismaError.code,
          prismaMessage: prismaError.message,
        };
    }
    }
  }

  // 3. Authentication & Authorization Errors
  else if (
    statusCode === 401 ||
    error.message?.includes('jwt') ||
    error.message?.includes('token')
  ) {
    statusCode = 401;
    if (error.message?.includes('expired')) {
      code = 'TOKEN_EXPIRED';
      message = 'Your session has expired. Please log in again.';
    } else {
      code = (error.code && error.code !== 'INTERNAL_ERROR') ? error.code : 'TOKEN_INVALID';
      message = error.message || 'Invalid authentication token provided.';
    }
  } else if (statusCode === 403 || error.message?.includes('permission')) {
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
  if (statusCode === 500 && env.NODE_ENV === 'production' && code !== 'DATABASE_ERROR') {
    message = 'An internal server error occurred';
  }

  const errorResponse = {
    error: {
      code,
      message,
      requestId:
        (request.headers['x-request-id'] as string) || (request.id as string),
      timestamp: new Date().toISOString(),
      details,
      ...(env.NODE_ENV !== 'production' && { stack: error.stack }),
    },
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

/**
 * Returns a structurally valid empty response based on the endpoint URL.
 * This prevents the frontend from crashing during database cold starts by
 * providing the expected array or object shapes.
 */
function getGracefulEmptyResponse(request: FastifyRequest) {
  const url = request.url || '';
  
  if (url.includes('/metrics/system')) {
    return {
      totalNodes: 0,
      onlineNodes: 0,
      offlineNodes: 0,
      degradedNodes: 0,
      totalTasks: 0,
      pendingTasks: 0,
      runningTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      avgLatency: 0,
      totalCost: 0,
      edgeUtilization: 0,
      cloudUtilization: 0,
      throughput: 0,
      healthScore: 0,
      completionRate: 0,
      cpuHistory: [],
      taskDistribution: { edge: 0, cloud: 0 },
      costOverTime: [],
      timestamp: new Date().toISOString()
    };
  }
  
  if (url.includes('/metrics/tenant')) {
    return {
      tasks: { total: 0, active: 0, completed: 0, failed: 0 },
      resources: { cpuUsed: 0, memoryUsed: 0, networkTotal: 0, storageTotal: 0 },
      cost: { currentMonth: 0, projected: 0, budget: 0 },
      events: []
    };
  }

  if (url.includes('/metrics/')) {
    return { data: [], timeline: [] };
  }

  if (url.includes('/alerts')) {
    return { alerts: [] };
  }

  if (url.includes('/logs/stats')) {
    return { total: 0, errorsLast24h: 0, storageUsageGB: 0 };
  }
  
  if (url.includes('/carbon/report') || url.includes('/carbon/stats') || url.includes('/analytics/')) {
    return { data: [], metrics: {}, summary: {} };
  }
  
  if (url.includes('/scheduling/policies')) {
    return { policies: [] };
  }
  
  if (url.includes('/webhooks')) {
    return { webhooks: [] };
  }
  
  if (url.includes('/fl/models') || url.includes('/ml/models')) {
    return { models: [] };
  }
  
  if (url.includes('/fl/tasks') || url.includes('/ml/tasks')) {
    return { tasks: [] };
  }
  
  // General fallback for lists with pagination
  if (url.includes('/tasks') || url.includes('/logs') || url.includes('/nodes')) {
    return { 
      data: [], 
      pagination: { page: 1, limit: 50, total: 0, totalPages: 0, hasNext: false, hasPrev: false } 
    };
  }

  // Default fallback for any other unexpected list endpoint
  return [];
}

export const errorHandler = fp(async (fastify: FastifyInstance) => {
  process.stdout.write('[errorHandler plugin] INITIALIZING...\n');
  fastify.setErrorHandler(globalErrorHandler);
});

export default errorHandler;
