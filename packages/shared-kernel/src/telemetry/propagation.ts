import { context, propagation, ROOT_CONTEXT } from "@opentelemetry/api";
import type { TextMapGetter, TextMapSetter, Context } from "@opentelemetry/api";

/**
 * TextMapSetter for plain object headers
 */
const headerSetter: TextMapSetter<Record<string, string>> = {
  set(carrier, key, value) {
    carrier[key] = value;
  },
};

/**
 * TextMapGetter for plain object headers
 */
const headerGetter: TextMapGetter<Record<string, string>> = {
  keys(carrier) {
    return Object.keys(carrier);
  },
  get(carrier, key) {
    return carrier[key];
  },
};

/**
 * Inject tracing context into a headers object
 */
export function injectTraceHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  propagation.inject(context.active(), headers, headerSetter);
  return headers;
}

/**
 * Extract tracing context from a headers object
 */
export function extractTraceContext(
  headers: Record<string, any> = {},
): Context {
  // Convert any non-string values (e.g. from Kafka headers) to strings
  const stringHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) {
      stringHeaders[key] = value.toString();
    }
  }

  return propagation.extract(ROOT_CONTEXT, stringHeaders, headerGetter);
}

/**
 * Run a function within an extracted context
 */
export async function withExtractedContext<T>(
  headers: Record<string, any>,
  fn: () => Promise<T>,
): Promise<T> {
  const extractedContext = extractTraceContext(headers);
  return context.with(extractedContext, fn);
}
