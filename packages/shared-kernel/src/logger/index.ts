import pino from "pino";
import type { Logger, LoggerOptions } from "pino";
import { getRequestId, getActiveTraceContext } from "./context.js";
import { VERSION } from "../constants.js";

export type { Logger };
export {
  getActiveTraceContext,
  injectTraceContextToLog,
  getRequestId,
  getTraceId,
  getLogContext,
  runWithContext,
  runWithRequestId,
} from "./context.js";

export interface LoggerConfig {
  serviceName: string;
  level?: string;
  environment?: string;
}

/**
 * Creates a standardized pino logger for Edge-Cloud Orchestrator services.
 */
export function createLogger(serviceName: string): Logger {
  const environment = process.env.NODE_ENV || "development";
  const isDev = environment === "development";

  const options: LoggerOptions = {
    level: process.env.LOG_LEVEL || "info",
    base: {
      service: serviceName,
      version: VERSION,
      environment,
    },
    // Tracing mixin: Automatically include trace_id, span_id in every log
    mixin() {
      const traceContext = getActiveTraceContext();
      const requestId = getRequestId();

      const tracing: Record<string, string> = {
        ...traceContext,
      };

      if (requestId) {
        tracing.requestId = requestId;
      }

      return tracing;
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => {
        return { level: label.toUpperCase() };
      },
    },
    redact: {
      paths: [
        "password",
        "passwordHash",
        "token",
        "refreshToken",
        "accessToken",
        "secret",
        "key",
        "apiKey",
        "hashedKey",
        "certificatePem",
        "privateKeyPem",
        "authorization",
        "cookie",
        "set-cookie",
      ],
      censor: "[REDACTED]",
    },
    ...(isDev && {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          ignore: "service,version,environment",
          messageFormat: "[{service}] {msg}",
        },
      },
    }),
  };

  return pino(options);
}

export const logger = createLogger("shared-kernel");
