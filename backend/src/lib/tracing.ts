/**
 * OpenTelemetry Distributed Tracing Setup
 * 
 * This module configures distributed tracing for the application,
 * allowing request flows to be tracked across services.
 */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { Resource } from '@opentelemetry/resources'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis'
import type { FastifyInstance } from 'fastify'

let sdk: NodeSDK | null = null

export function initTracing(): void {
  const enabled = process.env.OTEL_ENABLED === 'true'
  
  if (!enabled) {
    console.log('📊 OpenTelemetry tracing disabled')
    return
  }

  const serviceName = process.env.OTEL_SERVICE_NAME || 'edge-cloud-orchestrator'
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317'

  const traceExporter = new OTLPTraceExporter({
    url: endpoint,
  })

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
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
    } as any,
  })

  sdk.start()
  console.log(`📊 OpenTelemetry tracing enabled (${serviceName} → ${endpoint})`)
}

export function shutdownTracing(): Promise<void> {
  if (sdk) {
    return sdk.shutdown()
  }
  return Promise.resolve()
}

// Middleware to add trace context to requests
export function tracingMiddleware(fastify: FastifyInstance): void {
  fastify.addHook('onRequest', async (request, reply) => {
    // Add trace ID to response headers for debugging
    const span = (request as any).span
    if (span) {
      reply.header('X-Trace-Id', span.spanContext().traceId)
      reply.header('X-Span-Id', span.spanContext().spanId)
    }
  })
}

// Helper to create custom spans
export async function withSpan<T>(
  name: string,
  operation: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  const { trace } = await import('@opentelemetry/api')
  const tracer = trace.getTracer('edge-cloud-orchestrator')
  
  return tracer.startActiveSpan(name, async (span) => {
    try {
      if (attributes) {
        Object.entries(attributes).forEach(([key, value]) => {
          span.setAttribute(key, value)
        })
      }
      
      const result = await operation()
      span.setStatus({ code: 1 }) // OK
      return result
    } catch (error) {
      span.setStatus({
        code: 2, // ERROR
        message: error instanceof Error ? error.message : 'Unknown error',
      })
      span.recordException(error as Error)
      throw error
    } finally {
      span.end()
    }
  })
}
