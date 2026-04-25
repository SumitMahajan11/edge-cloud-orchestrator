import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { v4 as uuidv4 } from 'uuid';
import { runWithContext } from './context';
import type { Logger } from 'pino';

export interface LoggingPluginOptions {
  logger: Logger;
  serviceName: string;
}

const SENSITIVE_KEYS = /password|secret|token|key|credential|authorization|cookie/i;

/**
 * Standardized sanitization logic for logged objects.
 */
export function sanitize(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  
  const result: any = Array.isArray(obj) ? [] : {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.test(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      result[key] = sanitize(value);
    } else if (typeof value === 'string' && value.length > 512) {
      result[key] = value.substring(0, 512) + '... [TRUNCATED]';
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

const loggingPluginCallback: FastifyPluginAsync<LoggingPluginOptions> = async (
  fastify: FastifyInstance,
  options: LoggingPluginOptions
) => {
  const { logger } = options;

  fastify.addHook('onRequest', async (request, reply) => {
    const requestId = (request.headers['x-request-id'] as string) || uuidv4();
    reply.header('x-request-id', requestId);

    // Set up AsyncLocalStorage context for the entire request duration
    return new Promise<void>((resolve) => {
      runWithContext({ requestId }, () => {
        // Log request start
        logger.info({
          type: 'request_start',
          method: request.method,
          url: request.url,
          remoteAddress: request.ip,
          requestId,
        }, `Incoming ${request.method} ${request.url}`);
        
        resolve();
      });
    });
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const duration = reply.getResponseTime();
    logger.info({
      type: 'request_end',
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      duration,
    }, `Finished ${request.method} ${request.url} with ${reply.statusCode}`);
  });

  fastify.addHook('onError', async (request, _reply, error) => {
    logger.error({
      type: 'request_error',
      method: request.method,
      url: request.url,
      error: sanitize(error),
    }, `Error in ${request.method} ${request.url}: ${error.message}`);
  });

  // Global serializer for all logs in this fastify instance
  // Note: Pino doesn't easily allow runtime injection into its serializers via Fastify hooks,
  // but we can provide sanitized objects to the logger.
};

export const fastifyLoggingPlugin = fp(loggingPluginCallback);
