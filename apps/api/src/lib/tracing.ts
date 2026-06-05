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
import {
  ParentBasedSampler,
  BatchSpanProcessor,
  SpanProcessor,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import type { FastifyInstance } from 'fastify';

import { createLogger } from './logger';
import { env } from '../config/env';
import { CompositeSampler } from './otel-sampler';

const logger = createLogger('tracing');

/**
 * TailSamplingSpanProcessor for ML Scheduler
 * Discards spans for ML decisions that are fast (< 20ms) and didn't fallback.
 */
class TailSamplingSpanProcessor implements SpanProcessor {
  constructor(private delegate: SpanProcessor) {}

  onStart(span: any, parentContext: any): void {
    this.delegate.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    if (span.name === 'scheduler:ml_decision') {
      const durationMs = (span.duration[0] * 1e9 + span.duration[1]) / 1e6;
      const isFallback = span.attributes['ml.fallback'] === true;

      if (durationMs < 20 && !isFallback) {
        return; // Discard
      }
    }
    this.delegate.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush();
  }
  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }
}

let sdk: NodeSDK | null = null;

export function initTracing(): void {
  const enabled = env.OTEL_ENABLED;

  if (!enabled) {
    logger.info('OpenTelemetry tracing disabled');
    return;
  }

  const serviceName = env.OTEL_SERVICE_NAME;
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;

  const traceExporter = new OTLPTraceExporter({
    url: endpoint,
  });

  const sampler = new ParentBasedSampler({
    root: new CompositeSampler(0.1, 0.01),
  });

  // Wrap batch processor with our tail sampling logic
  const batchProcessor = new BatchSpanProcessor(traceExporter);
  const tailProcessor = new TailSamplingSpanProcessor(batchProcessor);

  sdk = new NodeSDK({
    sampler,
    spanProcessor: tailProcessor,
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
      'deployment.environment': env.NODE_ENV,
    } as any,
  });

  sdk.start();
  logger.info(
    { serviceName, endpoint },
    'OpenTelemetry tracing enabled with advanced sampling',
  );
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
      void reply.header('X-Trace-Id', span.spanContext().traceId);
      void reply.header('X-Span-Id', span.spanContext().spanId);
    }
  });
}

// Helper to create custom spans
export async function withSpan<T>(
  name: string,
  operation: (span: any) => Promise<T>,
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

      const result = await operation(span);
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
