import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { Resource } from "@opentelemetry/resources";

export function initTracing(serviceName: string, serviceVersion: string) {
  if (process.env.OTEL_ENABLED !== "true") {
    return; // Opt-in — don't force tracing in all environments
  }

  const sdk = new NodeSDK({
    resource: new Resource({
      "service.name": serviceName,
      "service.version": serviceVersion,
    }),
    traceExporter: new OTLPTraceExporter({
      url:
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
        "http://localhost:4318/v1/traces",
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false }, // too noisy
      }),
    ],
  });

  sdk.start();

  process.on("SIGTERM", () => sdk.shutdown());
}
