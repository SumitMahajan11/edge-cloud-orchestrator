import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { v4 as uuidv4 } from "uuid";
import { runWithContext } from "./context.js";
import type { Logger } from "pino";
import { tracer } from "../telemetry/index.js";

export interface LoggingPluginOptions {
  logger: Logger;
  serviceName: string;
}

const SENSITIVE_KEYS =
  /password|secret|token|key|credential|authorization|cookie/i;

/**
 * Standardized sanitization logic for logged objects.
 */
export function sanitize(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;

  const result: any = Array.isArray(obj) ? [] : {};

  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.test(key)) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object") {
      result[key] = sanitize(value);
    } else if (typeof value === "string" && value.length > 512) {
      result[key] = value.substring(0, 512) + "... [TRUNCATED]";
    } else {
      result[key] = value;
    }
  }

  return result;
}

const loggingPluginCallback: FastifyPluginAsync<LoggingPluginOptions> = async (
  fastify: FastifyInstance,
  options: LoggingPluginOptions,
) => {
  const { logger } = options;

  fastify.addHook("onRequest", async (request, reply) => {
    const requestId = (request.headers["x-request-id"] as string) || uuidv4();
    const traceId = (request.headers["x-trace-id"] as string) || requestId;

    void reply.header("x-request-id", requestId);
    void reply.header("x-trace-id", traceId);

    // Set up AsyncLocalStorage context for the entire request duration
    return new Promise<void>((resolve) => {
      runWithContext({ requestId, traceId }, () => {
        // Log request start
        logger.info(
          {
            type: "request_start",
            method: request.method,
            url: request.url,
            remoteAddress: request.ip,
            requestId,
            trace_id: traceId,
          },
          `Incoming ${request.method} ${request.url}`,
        );

        resolve();
      });
    });
  });

  fastify.addHook("preHandler", async (request) => {
    // Create OTel span for the request
    const span = tracer.startSpan(
      `http:${request.method}:${request.routerPath || request.url}`,
    );
    span.setAttributes({
      "http.method": request.method,
      "http.url": request.url,
      "http.request_id":
        (request.headers["x-request-id"] as string) || request.id,
      "http.trace_id": request.headers["x-trace-id"] as string,
    });

    // Attach span to request for manual instrumentation in handlers
    (request as any).span = span;
  });

  fastify.addHook("onResponse", async (request, reply) => {
    const duration = reply.getResponseTime();
    logger.info(
      {
        type: "request_end",
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        duration,
      },
      `Finished ${request.method} ${request.url} with ${reply.statusCode}`,
    );

    // End OTel span
    const span = (request as any).span;
    if (span) {
      span.setAttribute("http.status_code", reply.statusCode);
      span.end();
    }
  });

  fastify.addHook("onError", async (request, _reply, error) => {
    logger.error(
      {
        type: "request_error",
        method: request.method,
        url: request.url,
        error: sanitize(error),
      },
      `Error in ${request.method} ${request.url}: ${error.message}`,
    );

    // Record error in OTel span
    const span = (request as any).span;
    if (span) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message }); // 2 = ERROR
    }
  });
};

export const fastifyLoggingPlugin = fp(loggingPluginCallback);
