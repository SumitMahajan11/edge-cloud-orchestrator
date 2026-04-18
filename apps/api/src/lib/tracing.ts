/**
 * OpenTelemetry Distributed Tracing Setup
 *
 * This module configures distributed tracing for the application,
 * allowing request flows to be tracked across services.
 */

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { FastifyInstance } from 'fastify';

import { createLogger } from './logger';

const logger = createLogger('tracing');

let sdk: NodeSDK | null = null;

export function initTracing(): void {
  const enabled = process.env.OTEL_ENABLED === 'true';

  if (!enabled) {
    logger.info('OpenTelemetry tracing disabled');
    return;
  }

  const serviceName =
    process.env.OTEL_SERVICE_NAME || 'edge-cloud-orchestrator';
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317';

  const traceExporter = new OTLPTraceExporter({
    url: endpoint,
  });

  sdk = new NodeSDK({
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations(),
      new FastifyInstrumentation(),
      new HttpInstrumentation(),
      new PgInstrumentation(),
      new RedisInstrumentation(),
    ],
    resource: {
      'service.name': serviceName,
      'service.version': '1.0.0',
      'deployment.environment': process.env.NODE_ENV || 'development',
    } as any,
  });

  sdk.start();
  logger.info({ serviceName, endpoint }, 'OpenTelemetry tracing enabled');
}

export function shutdownTracing(): Promise<void> {
  if (sdk) {
    return sdk.shutdown();
  }
  return Promise.resolve();
}

// Middleware to add trace context to requests
export function tracingMiddleware(fastify: FastifyInstance): void {
  fastify.addHook('onRequest', async (request, reply) => {
    // Add trace ID to response headers for debugging
    const { span } = request as any;
    if (span) {
      reply.header('X-Trace-Id', span.spanContext().traceId);
      reply.header('X-Span-Id', span.spanContext().spanId);
    }
  });
}

// Helper to create custom spans
export async function withSpan<T>(
  name: string,
  operation: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  const { trace } = await import('@opentelemetry/api');
  const tracer = trace.getTracer('edge-cloud-orchestrator');

  return tracer.startActiveSpan(name, async (span) => {
    try {
      if (attributes) {
        Object.entries(attributes).forEach(([key, value]) => {
          span.setAttribute(key, value);
        });
      }

      const result = await operation();
      span.setStatus({ code: 1 }); // OK
      return result;
    } catch (error) {
      span.setStatus({
        code: 2, // ERROR
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}
