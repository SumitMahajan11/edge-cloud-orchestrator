/**
 * Structured Logging with Pino
 *
 * This module configures structured logging for the application,
 * compatible with log aggregation systems like ELK/Loki.
 */

import pino from 'pino';
import { env } from '../config/env';
import { getActiveTraceContext } from './otel-log-context';

// Configure log level based on environment
const logLevel = env.LOG_LEVEL || 'info';
const logFormat = env.LOG_FORMAT || 'json';

// Create logger instance
export const logger = pino({
  level: logLevel,
  // Inject OpenTelemetry context automatically
  mixin() {
    return getActiveTraceContext();
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
