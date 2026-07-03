import "reflect-metadata";
import { vi } from "vitest";

// Mock Opentelemetry and Trace APIs to avoid binary/resolution issues in monorepo tests
vi.mock("@opentelemetry/api", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const mockSpan = {
    end: () => {},
    spanContext: () => ({ traceId: "1", spanId: "1" }),
    setStatus: () => {},
    setAttribute: () => {},
    setAttributes: () => {},
    recordException: () => {},
  };
  return {
    ...actual,
    trace: {
      getSpan: () => null,
      getTracer: () => ({
        startSpan: () => mockSpan,
        startActiveSpan: (name: string, options: any, fn?: any) => {
          const callback = typeof options === "function" ? options : fn;
          return callback(mockSpan);
        },
      }),
    },
    context: Object.assign(Object.create(actual.context), {
      active: () => ({}),
    }),
    propagation: Object.assign(Object.create(actual.propagation), {
      inject: () => {},
      extract: () => ({}),
    }),
  };
});

// Mock @opentelemetry/resources to avoid ES module resolution issues on Windows
vi.mock("@opentelemetry/resources", () => ({
  Resource: class {},
}));

// Mock @opentelemetry/sdk-node to prevent importing the actual package
vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: class {
    start() {}
    async shutdown() {}
  },
}));

// Mock @opentelemetry/auto-instrumentations-node
vi.mock("@opentelemetry/auto-instrumentations-node", () => ({
  getNodeAutoInstrumentations: () => [],
}));

// Mock @opentelemetry/exporter-jaeger
vi.mock("@opentelemetry/exporter-jaeger", () => ({
  JaegerExporter: class {},
}));

// Mock fastify-plugin which often fails in Vite/CJS environments
vi.mock("fastify-plugin", () => {
  const fp = (fn: any) => {
    fn[Symbol.for('skip-override')] = true;
    return fn;
  };
  return {
    default: fp,
    __esModule: true,
  };
});

// Mock pino-pretty
vi.mock("pino-pretty", () => ({
  default: () => ({}),
}));

// Mock observability package to prevent deep transitive dependency failures
vi.mock("@edgecloud/observability", () => {
  const mockSpan = {
    end: () => {},
    spanContext: () => ({ traceId: "1", spanId: "1" }),
    setStatus: () => {},
    setAttribute: () => {},
    setAttributes: () => {},
    recordException: () => {},
  };
  return {
    initTracing: () => {},
    MetricsCollector: class {
      recordMLFallback() {}
      recordSchedulingDecision() {}
      updateMLDrift() {}
      incrementCounter() {}
      recordGauge() {}
      recordMetric() {}
      recordCarbonMetrics() {}
      recordTaskCreated() {}
    },
    createTracer: () => ({
      startActiveSpan: (name: string, fn: any) => fn(mockSpan),
    }),
  };
});

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "fatal";
process.env.JWT_SECRET = process.env.JWT_SECRET || "a".repeat(32);
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "b".repeat(32);
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://test:test@localhost:5432/test_db?sslmode=require";
process.env.FORCE_MOCK_REDIS = process.env.FORCE_MOCK_REDIS || "true";
process.env.FORCE_MOCK_DB = process.env.FORCE_MOCK_DB || "true";
process.env.ALLOW_PRIVATE_IPS = process.env.ALLOW_PRIVATE_IPS || "true";
