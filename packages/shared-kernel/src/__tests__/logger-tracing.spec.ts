vi.unmock("@opentelemetry/api");
import { describe, it, expect, vi, beforeAll } from "vitest";
import { trace, context, SpanKind } from "@opentelemetry/api";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  createLogger,
  getActiveTraceContext,
  injectTraceContextToLog,
  runWithRequestId,
} from "../index.js";

describe("OpenTelemetry Logger Tracing Helper", () => {
  let tracer: any;

  beforeAll(() => {
    const contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);

    const provider = new BasicTracerProvider();
    trace.setGlobalTracerProvider(provider);
    tracer = trace.getTracer("test-tracer");
  });

  it("should return empty object and omit trace fields when no active span exists", () => {
    // Ensure no active span on current context
    context.with(context.active(), () => {
      const traceContext = getActiveTraceContext();
      expect(traceContext).toEqual({});

      const logRecord = { message: "test without span", level: "info" };
      const enriched: any = injectTraceContextToLog(logRecord);
      expect(enriched.trace_id).toBeUndefined();
      expect(enriched.span_id).toBeUndefined();
      expect(enriched.traceId).toBeUndefined();
      expect(enriched.spanId).toBeUndefined();
      expect(enriched.message).toBe("test without span");
    });
  });

  it("should extract trace_id and span_id when an active OpenTelemetry span exists", () => {
    const span = tracer.startSpan("test-active-span", { kind: SpanKind.INTERNAL });
    const spanContext = span.spanContext();

    context.with(trace.setSpan(context.active(), span), () => {
      const traceCtx = getActiveTraceContext();

      expect(traceCtx.trace_id).toBe(spanContext.traceId);
      expect(traceCtx.span_id).toBe(spanContext.spanId);
      expect(traceCtx.traceId).toBeUndefined();
      expect(traceCtx.spanId).toBeUndefined();

      const logRecord = { message: "operation succeeded", userId: "usr-123" };
      const enriched: any = injectTraceContextToLog(logRecord);

      expect(enriched.trace_id).toBe(spanContext.traceId);
      expect(enriched.span_id).toBe(spanContext.spanId);
      expect(enriched.userId).toBe("usr-123");
    });

    span.end();
  });

  it("should generate distinct trace_ids for two separate spans using the real OTel API", () => {
    const span1 = tracer.startSpan("span-1");
    const spanContext1 = span1.spanContext();

    let traceId1: string | undefined;
    let spanId1: string | undefined;

    context.with(trace.setSpan(context.active(), span1), () => {
      const traceCtx1 = getActiveTraceContext();
      traceId1 = traceCtx1.trace_id;
      spanId1 = traceCtx1.span_id;
    });
    span1.end();

    const span2 = tracer.startSpan("span-2");
    const spanContext2 = span2.spanContext();

    let traceId2: string | undefined;
    let spanId2: string | undefined;

    context.with(trace.setSpan(context.active(), span2), () => {
      const traceCtx2 = getActiveTraceContext();
      traceId2 = traceCtx2.trace_id;
      spanId2 = traceCtx2.span_id;
    });
    span2.end();

    expect(traceId1).toBe(spanContext1.traceId);
    expect(traceId2).toBe(spanContext2.traceId);
    expect(spanId1).toBe(spanContext1.spanId);
    expect(spanId2).toBe(spanContext2.spanId);
    expect(traceId1).toBeDefined();
    expect(traceId2).toBeDefined();
    expect(traceId1).not.toBe(traceId2);
    expect(spanId1).not.toBe(spanId2);
  });

  it("should automatically inject trace_id and span_id into Pino logs via createLogger mixin", () => {
    const logger = createLogger("test-service");
    const writeSpy = vi.fn();

    // Intercept pino output stream
    (logger as any)[Symbol.for("pino.write")] = writeSpy;

    const span = tracer.startSpan("logger-mixin-span");
    const spanContext = span.spanContext();

    context.with(trace.setSpan(context.active(), span), () => {
      logger.info({ action: "task_dispatched" }, "Task was dispatched");

      // Test mixin output directly
      const mixinFn = (logger as any)[Symbol.for("pino.mixin")];
      if (typeof mixinFn === "function") {
        const mixinResult = mixinFn();
        expect(mixinResult.trace_id).toBe(spanContext.traceId);
        expect(mixinResult.span_id).toBe(spanContext.spanId);
        expect(mixinResult.traceId).toBeUndefined();
        expect(mixinResult.spanId).toBeUndefined();
      }
    });

    span.end();
  });

  it("should fallback to AsyncLocalStorage context when runWithRequestId is used", () => {
    const customTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const customSpanId = "00f067aa0ba902b7";

    runWithRequestId("req-999", customTraceId, () => {
      const traceCtx = getActiveTraceContext();
      expect(traceCtx.trace_id).toBe(customTraceId);
      expect(traceCtx.traceId).toBeUndefined();

      const enriched: any = injectTraceContextToLog({ msg: "context log" });
      expect(enriched.trace_id).toBe(customTraceId);
      expect(enriched.requestId).toBe("req-999");
    }, customSpanId);
  });

  it("should integrate with fastifyLoggingPlugin and inject trace_id/span_id during app.inject GET /health", async () => {
    const { Writable } = await import("stream");
    const fastifyModule = await import("fastify");
    const fastify = fastifyModule.default || fastifyModule;
    const pinoModule = await import("pino");
    const pino = pinoModule.default || pinoModule;
    const { fastifyLoggingPlugin } = await import("../logger/fastify-plugin.js");

    const logLines: string[] = [];
    const captureStream = new Writable({
      write(chunk, _encoding, callback) {
        const str = chunk.toString().trim();
        if (str) {
          str.split("\n").forEach((line: string) => {
            if (line.trim()) logLines.push(line.trim());
          });
        }
        callback();
      },
    });

    const customLogger = pino(
      {
        level: "info",
        base: { service: "test-service", version: "1.0.0", environment: "test" },
        mixin() {
          return getActiveTraceContext();
        },
      },
      captureStream,
    );

    const app = fastify({ logger: false });
    await app.register(fastifyLoggingPlugin, {
      logger: customLogger,
      serviceName: "test-service",
    });

    app.get("/health", async () => ({ status: "ok" }));

    const span = tracer.startSpan("http-health-span");
    const spanContext = span.spanContext();

    await context.with(trace.setSpan(context.active(), span), async () => {
      await app.inject({
        method: "GET",
        url: "/health",
        headers: {
          "x-request-id": "req-fastify-12345",
          "x-trace-id": spanContext.traceId,
        },
      });
    });
    span.end();

    expect(logLines.length).toBeGreaterThan(0);
    console.log("=== RAW PROBE LOG LINES (ACTIVE SPAN) ===");
    for (const line of logLines) {
      console.log(line);
      const parsed = JSON.parse(line);
      expect(parsed.trace_id).toBe(spanContext.traceId);
      expect(parsed.span_id).toBe(spanContext.spanId);
      expect(parsed.traceId).toBeUndefined();
      expect(parsed.spanId).toBeUndefined();
    }
  });

  it("should integrate with fastifyLoggingPlugin and omit trace context when no active span exists", async () => {
    const { Writable } = await import("stream");
    const fastifyModule = await import("fastify");
    const fastify = fastifyModule.default || fastifyModule;
    const pinoModule = await import("pino");
    const pino = pinoModule.default || pinoModule;
    const { fastifyLoggingPlugin } = await import("../logger/fastify-plugin.js");

    const noSpanLogLines: string[] = [];
    const captureStream = new Writable({
      write(chunk, _encoding, callback) {
        const str = chunk.toString().trim();
        if (str) {
          str.split("\n").forEach((line: string) => {
            if (line.trim()) noSpanLogLines.push(line.trim());
          });
        }
        callback();
      },
    });

    const customLogger = pino(
      {
        level: "info",
        base: { service: "test-service", version: "1.0.0", environment: "test" },
        mixin() {
          return getActiveTraceContext();
        },
      },
      captureStream,
    );

    const app = fastify({ logger: false });
    await app.register(fastifyLoggingPlugin, {
      logger: customLogger,
      serviceName: "test-service",
    });

    app.get("/health", async () => ({ status: "ok" }));

    await app.inject({
      method: "GET",
      url: "/health",
      headers: {
        "x-request-id": "req-fastify-nospan",
      },
    });

    expect(noSpanLogLines.length).toBeGreaterThan(0);
    console.log("=== RAW PROBE LOG LINES (NO ACTIVE SPAN) ===");
    for (const line of noSpanLogLines) {
      console.log(line);
      const parsed = JSON.parse(line);
      expect(parsed.trace_id).toBeUndefined();
      expect(parsed.span_id).toBeUndefined();
      expect(parsed.traceId).toBeUndefined();
      expect(parsed.spanId).toBeUndefined();
    }
  });
});
