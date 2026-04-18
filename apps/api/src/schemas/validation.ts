/**
 * Centralized validation schemas using Zod
 * Used for input validation across all routes
 */

import { z } from 'zod';

// Common validation patterns
const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const k8sNameRegex = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

// Task types and enums
export const TaskType = z.enum([
  'IMAGE_CLASSIFICATION',
  'DATA_PROCESSING',
  'ML_TRAINING',
  'LOG_ANALYSIS',
  'VIDEO_TRANSCODING',
  'CUSTOM_CONTAINER',
]);

export const TaskPriority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const TaskStatus = z.enum([
  'PENDING',
  'VALIDATING',
  'SCHEDULED',
  'ASSIGNED',
  'DOWNLOADING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMEOUT',
]);

export const NodeStatus = z.enum([
  'ONLINE',
  'OFFLINE',
  'DEGRADED',
  'MAINTENANCE',
]);

// ID parameters
export const idParamSchema = z.object({
  id: z.string().regex(uuidRegex, 'Invalid UUID format'),
});

// Pagination
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Task creation
export const createTaskSchema = z.object({
  type: TaskType,
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  priority: TaskPriority.default('MEDIUM'),
  payload: z.record(z.unknown()).optional(),
  targetRegions: z.array(z.string()).optional(),
  cpuRequired: z.coerce.number().min(0).max(128).optional(),
  memoryRequired: z.coerce.number().min(0).max(1024).optional(), // GB
  timeout: z.coerce.number().int().min(1000).max(86400000).optional(), // ms, max 24h
  maxRetries: z.coerce.number().int().min(0).max(10).default(3),
  labels: z.record(z.string()).optional(),
});

// Task update
export const updateTaskSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  priority: TaskPriority.optional(),
  payload: z.record(z.unknown()).optional(),
  labels: z.record(z.string()).optional(),
});

// Task query
export const taskQuerySchema = z.object({
  status: TaskStatus.optional(),
  type: TaskType.optional(),
  priority: TaskPriority.optional(),
  nodeId: z.string().uuid().optional(),
  sortBy: z
    .enum([
      'submittedAt',
      'priority',
      'status',
      'duration',
      'createdAt',
      'updatedAt',
      'name',
    ])
    .default('submittedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  ...paginationSchema.shape,
});

// Task action (cancel, retry)
export const cancelTaskSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const retryTaskSchema = z.object({
  force: z.boolean().default(false),
});

// Node registration
export const registerNodeSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .regex(k8sNameRegex, 'Invalid Kubernetes name format'),
  region: z.string().min(1).max(100),
  capabilities: z.array(z.string()),
  cpuCores: z.coerce.number().int().min(1).max(256),
  memoryGb: z.coerce.number().min(1).max(1024),
  labels: z.record(z.string()).optional(),
  endpoint: z.string().url().optional(),
});

// Node heartbeat
export const nodeHeartbeatSchema = z.object({
  cpuUsage: z.coerce.number().min(0).max(100).optional(),
  memoryUsage: z.coerce.number().min(0).max(100).optional(),
  activeTasks: z.coerce.number().int().min(0).optional(),
  status: NodeStatus.optional(),
});

// Node update
export const updateNodeSchema = z.object({
  name: z.string().min(1).max(255).regex(k8sNameRegex).optional(),
  region: z.string().min(1).max(100).optional(),
  capabilities: z.array(z.string()).optional(),
  labels: z.record(z.string()).optional(),
  status: NodeStatus.optional(),
});

// User authentication
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const registerUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(255),
});

// Metrics query
export const metricsQuerySchema = z.object({
  start: z.coerce.date().optional(),
  end: z.coerce.date().optional(),
  step: z.string().optional(), // Prometheus duration format
});

// Policy configuration
export const policySchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['SCHEDULING', 'SCALING', 'SECURITY']),
  rules: z.array(z.record(z.unknown())),
  enabled: z.boolean().default(true),
  priority: z.coerce.number().int().min(0).max(1000).default(100),
});

// WebSocket authentication
export const wsAuthSchema = z.object({
  type: z.literal('authenticate'),
  payload: z.object({
    token: z.string().min(1),
  }),
});

// WebSocket subscription
export const wsSubscribeSchema = z.object({
  type: z.literal('subscribe'),
  payload: z.object({
    channels: z.array(z.string().min(1)).min(1).max(10),
  }),
});

// Validate and sanitize input
export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}

// Safe parse that returns null on failure
export function safeValidateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): T | null {
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}

// Type guard functions for runtime validation
export function isValidTaskType(
  value: unknown,
): value is z.infer<typeof TaskType> {
  return TaskType.safeParse(value).success;
}

export function isValidTaskPriority(
  value: unknown,
): value is z.infer<typeof TaskPriority> {
  return TaskPriority.safeParse(value).success;
}

export function isValidTaskStatus(
  value: unknown,
): value is z.infer<typeof TaskStatus> {
  return TaskStatus.safeParse(value).success;
}

export function isValidNodeStatus(
  value: unknown,
): value is z.infer<typeof NodeStatus> {
  return NodeStatus.safeParse(value).success;
}

// Parse with error context
export function parseWithValidation<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context?: string,
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(
      `Validation failed${context ? ` for ${context}` : ''}: ${issues}`,
    );
  }
  return result.data;
}
