import pino, { Logger, LoggerOptions } from 'pino';
import { trace, context } from '@opentelemetry/api';
import { getRequestId } from './context';
import { VERSION } from '../index';

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
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            ignore: 'service,version,environment',
            messageFormat: '[{service}] {msg}',
          },
        }
      : undefined, // Defaut JSON stdout for production
  };

  return pino(options);
}
