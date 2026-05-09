import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { ConsoleSpanExporter, SimpleSpanProcessor, BatchSpanProcessor, ParentBasedSampler } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { CompositeSampler } from './otel-sampler';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Initializes OpenTelemetry tracing for the web application.
 * Correlates frontend user actions with backend traces using traceparent propagation.
 */
export function initTracing() {
  if (typeof window === 'undefined') return;

  const sampler = new ParentBasedSampler({
    root: new CompositeSampler(0.1),
  });

  const provider = new WebTracerProvider({
    sampler,
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: 'edge-cloud-dashboard',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'production',
    }),
  });

  // 1. Console Exporter for Development
  if (isDev) {
    provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  // 2. OTLP HTTP Exporter for Production (and Dev collector)
  const otlpEndpoint = process.env.NEXT_PUBLIC_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces';
  const otlpExporter = new OTLPTraceExporter({
    url: otlpEndpoint,
  });
  provider.addSpanProcessor(new BatchSpanProcessor(otlpExporter));

  // 3. Register Provider
  provider.register();

  // 4. Register Auto-instrumentation for Fetch and XHR
  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: [
          /localhost:3090/, // API Port
          /.*\.edgecloud\.io/, // Production domain
        ],
      }),
      new XMLHttpRequestInstrumentation({
        propagateTraceHeaderCorsUrls: [
          /localhost:3090/,
          /.*\.edgecloud\.io/,
        ],
      }),
    ],
  });

  console.log('🌐 Web Telemetry Initialized');
}

export const tracer = trace.getTracer('edge-cloud-dashboard');

export async function withSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span: Span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: any) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}
