import type { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { runWithContext } from "./context.js";
import type { Logger } from "pino";
import { tracer } from "../telemetry/index.js";
import { SpanStatusCode } from "@opentelemetry/api";

/**
 * Standardized logging middleware for Express (used by edge-agent).
 */
export function createExpressLoggingMiddleware(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers["x-request-id"] as string) || uuidv4();
    const traceId = (req.headers["x-trace-id"] as string) || requestId;

    res.setHeader("x-request-id", requestId);
    res.setHeader("x-trace-id", traceId);

    runWithContext({ requestId, traceId }, () => {
      const startTime = Date.now();

      // Start OTel span
      const span = tracer.startSpan(`http:${req.method}:${req.path}`);
      span.setAttributes({
        "http.method": req.method,
        "http.url": req.url,
        "http.request_id": requestId,
        "http.trace_id": traceId,
      });

      // Attach span to request
      (req as any).span = span;

      logger.info(
        {
          type: "request_start",
          method: req.method,
          url: req.url,
          remoteAddress: req.ip,
          requestId,
          traceId,
        },
        `Incoming ${req.method} ${req.url}`,
      );

      res.on("finish", () => {
        const duration = Date.now() - startTime;
        logger.info(
          {
            type: "request_end",
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            duration,
          },
          `Finished ${req.method} ${req.url} with ${res.statusCode}`,
        );

        // End OTel span
        span.setAttribute("http.status_code", res.statusCode);
        if (res.statusCode >= 400) {
          span.setStatus({ code: SpanStatusCode.ERROR });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }
        span.end();
      });

      next();
    });
  };
}
