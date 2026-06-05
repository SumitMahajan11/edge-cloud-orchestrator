/**
 * Structured Logging with Pino
 *
 * This module configures structured logging for the application,
 * compatible with log aggregation systems like ELK/Loki.
 */

import pino from 'pino';
import { trace } from '@opentelemetry/api';
import { env } from '../config/env';

// Configure log level based on environment
const logLevel = env.LOG_LEVEL || 'info';
const logFormat = env.LOG_FORMAT || 'json';

// Create logger instance
export const logger = pino({
  level: logLevel,
  // Inject OpenTelemetry context automatically
  mixin() {
    const span = trace.getActiveSpan();
    if (!span) return {};

    const { traceId, spanId } = span.spanContext();
    return { traceId, spanId };
  },
  // Pretty print in development, JSON in production
  ...(logFormat === 'pretty' && env.NODE_ENV !== 'production'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
  // Add standard fields for log aggregation
  base: {
    service: 'edge-cloud-orchestrator',
    version: '1.0.0',
    environment: env.NODE_ENV,
  },
  // Redact sensitive fields
  redact: {
    paths: [
      'password',
      'passwordHash',
      'token',
      'refreshToken',
      'apiKey',
      'secret',
      'headers.authorization',
      'headers.cookie',
    ],
    remove: true,
  },
});

// Child loggers for specific components
export function createLogger(component: string) {
  return logger.child({ component });
}

// Request logging helper
export function logRequest(
  requestId: string,
  method: string,
  url: string,
  statusCode: number,
  duration: number,
  userId?: string,
) {
  const logData = {
    requestId,
    method,
    url,
    statusCode,
    duration,
    ...(userId && { userId }),
  };

  if (statusCode >= 500) {
    logger.error(logData, 'Request failed');
  } else if (statusCode >= 400) {
    logger.warn(logData, 'Request error');
  } else {
    logger.info(logData, 'Request completed');
  }
}

// Error logging helper
export function logError(
  error: Error,
  context: Record<string, unknown> = {},
  requestId?: string,
) {
  logger.error(
    {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      ...context,
      ...(requestId && { requestId }),
    },
    error.message,
  );
}

// Audit logging helper
export function logAudit(
  userId: string,
  action: string,
  resource: string,
  resourceId?: string,
  details?: Record<string, unknown>,
) {
  logger.info(
    {
      audit: true,
      userId,
      action,
      resource,
      resourceId,
      details,
      timestamp: new Date().toISOString(),
    },
    `Audit: ${action} on ${resource}`,
  );
}

// Performance logging helper
export function logPerformance(
  operation: string,
  duration: number,
  metadata?: Record<string, unknown>,
) {
  logger.info(
    {
      performance: true,
      operation,
      duration,
      ...metadata,
    },
    `Performance: ${operation} took ${duration}ms`,
  );
}

// Seed script logger (runs outside main app context)
export const seedLogger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname,service,version,environment',
    },
  },
});
