// ============================================================================
// Zod to Fastify Schema Converter
// ============================================================================
// 
// Converts Zod schemas to JSON Schema format for Fastify route validation.
// Fastify uses AJV for validation which requires JSON Schema, not Zod.
// ============================================================================

import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

// ============================================================================
// Types
// ============================================================================

/**
 * Fastify-compatible JSON Schema for route validation
 */
export interface FastifySchema {
  body?: unknown
  querystring?: unknown
  params?: unknown
  headers?: unknown
  response?: Record<string, unknown>
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
  options?: { stripNull?: boolean }
): Record<string, unknown> {
  const jsonSchema = zodToJsonSchema(schema, {
    // Remove $schema property that zod-to-json-schema adds
    $refStrategy: 'none',
    // Target JSON Schema Draft 7 (compatible with AJV)
    target: 'jsonSchema7',
  })
  
  // Remove $schema property if present
  if (jsonSchema.$schema) {
    delete jsonSchema.$schema
  }
  
  return jsonSchema as Record<string, unknown>
}

/**
 * Create a complete Fastify schema object from Zod schemas.
 * 
 * Usage:
 * ```typescript
 * fastify.post('/tasks', {
 *   schema: createSchema({
 *     body: createTaskSchema,
 *     response: {
 *       201: taskResponseSchema,
 *     },
 *   }),
 * }, handler)
 * ```
 */
export function createSchema(schemas: {
  body?: z.ZodType
  querystring?: z.ZodType
  params?: z.ZodType
  headers?: z.ZodType
  response?: Record<string, z.ZodType>
}): FastifySchema {
  const result: FastifySchema = {}
  
  if (schemas.body) {
    result.body = zodToFastifySchema(schemas.body)
  }
  
  if (schemas.querystring) {
    result.querystring = zodToFastifySchema(schemas.querystring)
  }
  
  if (schemas.params) {
    result.params = zodToFastifySchema(schemas.params)
  }
  
  if (schemas.headers) {
    result.headers = zodToFastifySchema(schemas.headers)
  }
  
  if (schemas.response) {
    result.response = {}
    for (const [status, schema] of Object.entries(schemas.response)) {
      result.response[status] = zodToFastifySchema(schema)
    }
  }
  
  return result
}

// ============================================================================
// Inline Schema Helpers
// ============================================================================

/**
 * Create a typed body schema for Fastify routes.
 */
export function body<T extends z.ZodType>(schema: T): Record<string, unknown> {
  return zodToFastifySchema(schema)
}

/**
 * Create a typed querystring schema for Fastify routes.
 */
export function query<T extends z.ZodType>(schema: T): Record<string, unknown> {
  return zodToFastifySchema(schema)
}

/**
 * Create a typed params schema for Fastify routes.
 */
export function params<T extends z.ZodType>(schema: T): Record<string, unknown> {
  return zodToFastifySchema(schema)
}

// ============================================================================
// Example Usage
// ============================================================================

/**
 * Example route with Zod schema conversion:
 * 
 * ```typescript
 * import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
 * import { z } from 'zod'
 * import { createSchema, zodToFastifySchema } from './zod-schema'
 * 
 * const createTaskSchema = z.object({
 *   name: z.string().min(1),
 *   type: z.enum(['IMAGE_CLASSIFICATION', 'DATA_AGGREGATION']),
 *   priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
 * })
 * 
 * type CreateTaskBody = z.infer<typeof createTaskSchema>
 * 
 * // Method 1: Using createSchema helper
 * fastify.post<{ Body: CreateTaskBody }>('/tasks', {
 *   schema: createSchema({ body: createTaskSchema }),
 * }, async (request, reply) => {
 *   // request.body is typed!
 *   const { name, type, priority } = request.body
 *   return { id: '123', name }
 * })
 * 
 * // Method 2: Direct conversion
 * fastify.post<{ Body: CreateTaskBody }>('/tasks', {
 *   schema: {
 *     body: zodToFastifySchema(createTaskSchema),
 *   },
 * }, handler)
 * ```
 */
