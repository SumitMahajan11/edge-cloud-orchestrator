import pino from 'pino';
import type { Logger, LoggerOptions } from 'pino';
import { trace, context } from '@opentelemetry/api';
import { getRequestId } from './context.js';
import { VERSION } from '../constants.js';

export type { Logger };

export interface LoggerConfig {
  serviceName: string;
  level?: string;
  environment?: string;
}

/**
 * Creates a standardized pino logger for Edge-Cloud Orchestrator services.
 */
export function createLogger(serviceName: string): Logger {
  const environment = process.env.NODE_ENV || 'development';
  const isDev = environment === 'development';

  const options: LoggerOptions = {
    level: process.env.LOG_LEVEL || 'info',
    base: {
      service: serviceName,
      version: VERSION,
      environment,
    },
    // Tracing mixin: Automatically include traceId and spanId in every log
    mixin() {
      const activeSpan = trace.getSpan(context.active());
      const requestId = getRequestId();
      
      const tracing: Record<string, string> = {};
      
      if (activeSpan) {
        const spanContext = activeSpan.spanContext();
        tracing.traceId = spanContext.traceId;
        tracing.spanId = spanContext.spanId;
      }
      
      if (requestId) {
        tracing.requestId = requestId;
      }
      
      return tracing;
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => {
        return { level: label.toUpperCase() };
      },
    },
    redact: {
      paths: [
        'password',
        'passwordHash',
        'token',
        'refreshToken',
        'accessToken',
        'secret',
        'key',
        'apiKey',
        'hashedKey',
        'certificatePem',
        'privateKeyPem',
        'authorization',
        'cookie',
        'set-cookie',
      ],
      censor: '[REDACTED]',
    },
    ...(isDev && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'service,version,environment',
          messageFormat: '[{service}] {msg}',
        },
      }
    }),
  };

  return pino(options);
}

export const logger = createLogger('shared-kernel');
