// ============================================================================
// Zod to Fastify Schema Converter
// ============================================================================
//
// Converts Zod schemas to JSON Schema format for Fastify route validation.
// Fastify uses AJV for validation which requires JSON Schema, not Zod.
// ============================================================================

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ============================================================================
// Types
// ============================================================================

/**
 * Fastify-compatible JSON Schema for route validation
 */
export interface FastifySchema {
  body?: unknown;
  querystring?: unknown;
  params?: unknown;
  headers?: unknown;
  response?: Record<string, unknown>;
}

// ============================================================================
// Schema Converter
// ============================================================================

/**
 * Convert Zod schema to Fastify-compatible JSON Schema.
 *
 * @param schema - Zod schema to convert
 * @param options - Optional configuration
 * @returns JSON Schema object
 */
export function zodToFastifySchema<T extends z.ZodType>(
  schema: T,
  _options?: { stripNull?: boolean },
): Record<string, unknown> {
  const jsonSchema = zodToJsonSchema(schema, {
    // Remove $schema property that zod-to-json-schema adds
    $refStrategy: 'none',
    // Target JSON Schema Draft 7 (compatible with AJV)
    target: 'jsonSchema7',
  });

  // Remove $schema property if present
  if (jsonSchema.$schema) {
    delete jsonSchema.$schema;
  }

  return jsonSchema as Record<string, unknown>;
}
