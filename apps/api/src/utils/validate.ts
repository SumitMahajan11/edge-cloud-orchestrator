// ============================================================================
// Input Validation Layer with Zod
// ============================================================================
//
// Provides centralized input validation using Zod schemas.
// All API inputs MUST be validated through this layer.
// ============================================================================

import { z } from 'zod';

export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate data against a Zod schema
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @param context - Optional context for error messages
 * @returns Validated data (properly typed)
 *
 * @example
 * ```typescript
 * const taskSchema = z.object({
 *   name: z.string().min(1).max(100),
 *   type: z.enum(['compute', 'ml-inference', 'data-processing']),
 *   priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional()
 * });
 *
 * const validated = validate(taskSchema, request.body, 'task creation');
 * ```
 */
export function validate<T extends z.ZodType>(
  schema: T,
  data: unknown,
  context?: string,
): z.infer<T> {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.errors[0];
      if (!firstError) {
        throw new ValidationError(
          `${context ? context + ': ' : ''}Validation failed`,
          undefined,
          'unknown',
        );
      }
      const fieldPath = firstError.path.join('.');

      throw new ValidationError(
        `${context ? context + ': ' : ''}${firstError.message}`,
        fieldPath,
        firstError.code,
      );
    }
    throw error;
  }
}

/**
 * Validate and sanitize query parameters
 */
export function validateQuery<T extends z.ZodType>(
  schema: T,
  query: Record<string, string | string[] | undefined>,
): z.infer<T> {
  // Convert query params to proper types
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      normalized[key] = value;
    } else if (value !== undefined) {
      // Try to parse as JSON first, then number, then keep as string
      try {
        normalized[key] = JSON.parse(value);
      } catch {
        if (/^\d+$/.test(value)) {
          normalized[key] = parseInt(value, 10);
        } else if (/^\d+\.\d+$/.test(value)) {
          normalized[key] = parseFloat(value);
        } else {
          normalized[key] = value;
        }
      }
    }
  }

  return validate(schema, normalized, 'query parameters');
}

// ============================================================================
// Common Schemas (Reusable)
// ============================================================================

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.string().max(50).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

// ============================================================================
// Task Schemas
// ============================================================================

export const taskCreateSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['compute', 'ml-inference', 'data-processing', 'container']),
  command: z.string().max(1000),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  cpu: z.number().positive().max(32).optional(),
  memory: z.number().positive().max(65536).optional(), // MB
  timeout: z.number().positive().max(86400).optional(), // seconds
  nodeId: z.string().uuid().optional(),
  input: z.record(z.unknown()).optional(),
  metadata: z.record(z.string()).optional(),
  maxRetries: z.number().int().nonnegative().max(10).default(3),
});

export const taskQuerySchema = paginationSchema.merge(dateRangeSchema).merge(
  z.object({
    status: z
      .enum(['PENDING', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'FAILED'])
      .optional(),
    type: z.string().max(50).optional(),
    nodeId: z.string().uuid().optional(),
    priority: z.string().max(20).optional(),
  }),
);

// ============================================================================
// Node Schemas
// ============================================================================

export const nodeRegisterSchema = z.object({
  name: z.string().min(1).max(100),
  location: z.string().min(1).max(100),
  region: z.string().min(1).max(50),
  ipAddress: z.string().ip(),
  port: z.number().int().positive().max(65535),
  cpuCores: z.number().int().positive().max(128),
  memoryGB: z.number().positive().max(1024),
  storageGB: z.number().positive().max(10000),
  capabilities: z.array(z.string().max(50)).optional(),
  labels: z.record(z.string().max(100)).optional(),
});

export const nodeUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  location: z.string().min(1).max(100).optional(),
  cpuCores: z.number().int().positive().max(128).optional(),
  memoryGB: z.number().positive().max(1024).optional(),
  storageGB: z.number().positive().max(10000).optional(),
  isMaintenanceMode: z.boolean().optional(),
  labels: z.record(z.string().max(100)).optional(),
});

export const nodeMetricsSchema = z.object({
  cpuUsage: z.number().min(0).max(100),
  memoryUsage: z.number().min(0).max(100),
  storageUsage: z.number().min(0).max(100),
  networkLatency: z.number().positive(),
  tasksRunning: z.number().int().nonnegative(),
  tasksCompleted: z.number().int().nonnegative(),
  tasksFailed: z.number().int().nonnegative(),
});

// ============================================================================
// Auth Schemas
// ============================================================================

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const apiKeyCreateSchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.string().max(50)),
  expiresAt: z.string().datetime().optional(),
});

// ============================================================================
// Workflow Schemas
// ============================================================================

export const workflowCreateSchema = z.object({
  name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  variables: z.record(z.unknown()).optional(),
  timeout: z.number().positive().max(86400).optional(),
  retryPolicy: z
    .object({
      maxRetries: z.number().int().nonnegative().max(10),
      backoffMultiplier: z.number().positive(),
    })
    .optional(),
});

// ============================================================================
// Carbon Metrics Schema
// ============================================================================

export const carbonMetricSchema = z.object({
  nodeId: z.string().uuid(),
  region: z.string().max(50),
  energyKwh: z.number().positive(),
  carbonKg: z.number().positive(),
  renewablePercent: z.number().min(0).max(100),
});
