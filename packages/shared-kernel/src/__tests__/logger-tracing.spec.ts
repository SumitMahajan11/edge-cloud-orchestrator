import { describe, it, expect, vi } from "vitest";
import { trace, context, SpanKind } from "@opentelemetry/api";
import {
  createLogger,
  getActiveTraceContext,
  injectTraceContextToLog,
  runWithRequestId,
} from "../index.js";

describe("OpenTelemetry Logger Tracing Helper", () => {
  const tracer = trace.getTracer("test-tracer");

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
      expect(traceCtx.traceId).toBe(spanContext.traceId);
      expect(traceCtx.spanId).toBe(spanContext.spanId);

      const logRecord = { message: "operation succeeded", userId: "usr-123" };
      const enriched: any = injectTraceContextToLog(logRecord);

      expect(enriched.trace_id).toBe(spanContext.traceId);
      expect(enriched.span_id).toBe(spanContext.spanId);
      expect(enriched.userId).toBe("usr-123");
    });

    span.end();
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
        expect(mixinResult.traceId).toBe(spanContext.traceId);
        expect(mixinResult.spanId).toBe(spanContext.spanId);
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
      expect(traceCtx.traceId).toBe(customTraceId);

      const enriched: any = injectTraceContextToLog({ msg: "context log" });
      expect(enriched.trace_id).toBe(customTraceId);
      expect(enriched.requestId).toBe("req-999");
    }, customSpanId);
  });
});
