import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { ZipkinExporter } from '@opentelemetry/exporter-zipkin';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { BatchSpanProcessor, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { trace, Tracer, Span, SpanStatusCode, Context, context as apiContext } from '@opentelemetry/api';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { KafkaJsInstrumentation } from '@opentelemetry/instrumentation-kafkajs';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

export interface TracingConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  exporter?: 'jaeger' | 'zipkin' | 'otlp';
  jaegerEndpoint?: string;
  zipkinEndpoint?: string;
  otlpEndpoint?: string;
  samplingRate?: number;
}

export class TracingManager {
  private sdk: NodeSDK | null = null;
  private provider: NodeTracerProvider | null = null;
  private config: TracingConfig;
  private tracer: Tracer;

  constructor(config: TracingConfig) {
    this.config = {
      exporter: 'jaeger',
      jaegerEndpoint: 'http://jaeger:14268/api/traces',
      zipkinEndpoint: 'http://zipkin:9411/api/v2/spans',
      otlpEndpoint: 'http://otel-collector:4317',
      samplingRate: 1.0,
      ...config,
    };

    this.tracer = trace.getTracer(config.serviceName, config.serviceVersion);
  }

  async initialize(): Promise<void> {
    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: this.config.serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: this.config.serviceVersion,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: this.config.environment,
    });

    // Configure exporter
    let exporter;
    switch (this.config.exporter) {
      case 'zipkin':
        exporter = new ZipkinExporter({
          url: this.config.zipkinEndpoint,
        });
        break;
      case 'otlp':
        exporter = new OTLPTraceExporter({
          url: this.config.otlpEndpoint,
        });
        break;
      case 'jaeger':
      default:
        exporter = new JaegerExporter({
          endpoint: this.config.jaegerEndpoint,
        });
    }

    // Create span processor
    const spanProcessor = new BatchSpanProcessor(exporter);

    // Initialize SDK with auto-instrumentations
    this.sdk = new NodeSDK({
      resource,
      spanProcessor,
      instrumentations: [
        new HttpInstrumentation({
          requestHook: (span, request) => {
            span.setAttribute('http.request.body.size', request.headers['content-length'] || 0);
          },
          responseHook: (span, response) => {
            span.setAttribute('http.response.body.size', response.headers['content-length'] || 0);
          },
        }),
        new ExpressInstrumentation(),
        new PgInstrumentation({
          enhancedDatabaseReporting: true,
        }),
        new KafkaJsInstrumentation(),
      ],
    });

    await this.sdk.start();
    console.log(`Tracing initialized for ${this.config.serviceName}`);
  }

  async shutdown(): Promise<void> {
    if (this.sdk) {
      await this.sdk.shutdown();
    }
  }

  getTracer(): Tracer {
    return this.tracer;
  }

  // Helper method to create a span
  createSpan(
    name: string,
    options?: {
      parent?: Context;
      attributes?: Record<string, any>;
    }
  ): Span {
    const ctx = options?.parent || apiContext.active();
    return this.tracer.startSpan(name, {
      attributes: options?.attributes,
    }, ctx);
  }

  // Helper method to wrap a function in a span
  async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options?: {
      parent?: Context;
      attributes?: Record<string, any>;
    }
  ): Promise<T> {
    const span = this.createSpan(name, options);
    const ctx = trace.setSpan(apiContext.active(), span);

    try {
      const result = await apiContext.with(ctx, () => fn(span));
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  // Helper for database operations
  async traceDbOperation<T>(
    operation: string,
    table: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.withSpan(
      `db.${operation}`,
      async (span) => {
        span.setAttributes({
          'db.operation': operation,
          'db.table': table,
          'db.system': 'cockroachdb',
        });
        return fn();
      }
    );
  }

  // Helper for task operations
  async traceTaskOperation<T>(
    operation: string,
    taskId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.withSpan(
      `task.${operation}`,
      async (span) => {
        span.setAttributes({
          'task.id': taskId,
          'task.operation': operation,
        });
        return fn();
      }
    );
  }

  // Helper for scheduling operations
  async traceScheduling<T>(
    algorithm: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.withSpan(
      'scheduler.decision',
      async (span) => {
        span.setAttributes({
          'scheduler.algorithm': algorithm,
        });
        const startTime = Date.now();
        const result = await fn();
        span.setAttribute('scheduler.duration_ms', Date.now() - startTime);
        return result;
      }
    );
  }

  // Helper for event processing
  async traceEventProcessing<T>(
    topic: string,
    eventType: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.withSpan(
      'event.process',
      async (span) => {
        span.setAttributes({
          'messaging.system': 'kafka',
          'messaging.destination': topic,
          'messaging.destination_kind': 'topic',
          'event.type': eventType,
        });
        return fn();
      }
    );
  }

  // Helper for HTTP client calls
  async traceHttpClient<T>(
    method: string,
    url: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.withSpan(
      `http.client.${method}`,
      async (span) => {
        span.setAttributes({
          'http.method': method,
          'http.url': url,
        });
        return fn();
      }
    );
  }
}

// Singleton instance for the application
let tracingManager: TracingManager | null = null;

export function initializeTracing(config: TracingConfig): TracingManager {
  if (!tracingManager) {
    tracingManager = new TracingManager(config);
  }
  return tracingManager;
}

export function getTracingManager(): TracingManager | null {
  return tracingManager;
}
