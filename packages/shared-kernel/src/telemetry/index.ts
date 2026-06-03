import { diag, DiagConsoleLogger, DiagLogLevel, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
export { SpanKind, SpanStatusCode };
import { NodeSDK } from '@opentelemetry/sdk-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

// Set up diagnostic logging for OTel itself if needed
if (process.env.OTEL_DEBUG === 'true') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

export function initTelemetry(serviceName: string) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return {
      start: () => {},
      shutdown: async () => {},
    } as any;
  }

  const exporter = new JaegerExporter({
    endpoint: process.env.JAEGER_ENDPOINT || 'http://jaeger:6831',
  });

  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable noisier instrumentations or configure specifically
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-fastify': {
          enabled: true,
          requestHook: (span, info) => {
            if (info.request.params) {
              span.setAttributes(
                Object.entries(info.request.params as Record<string, any>).reduce((acc, [k, v]) => ({
                  ...acc,
                  [`http.route.param.${k}`]: v
                }), {})
              );
            }
          }
        }
      }),
    ],
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => console.log('Tracing terminated'))
      .catch((error) => console.log('Error terminating tracing', error))
      .finally(() => process.exit(0));
  });

  return sdk;
}

export const tracer = trace.getTracer('edge-cloud-orchestrator');
