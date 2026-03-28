import { z } from 'zod';

// Task schemas
export const TaskTypeSchema = z.enum([
  'IMAGE_CLASSIFICATION',
  'DATA_AGGREGATION',
  'MODEL_INFERENCE',
  'SENSOR_FUSION',
  'VIDEO_PROCESSING',
  'LOG_ANALYSIS',
  'ANOMALY_DETECTION',
  'CUSTOM',
]);

export const TaskStatusSchema = z.enum([
  'PENDING',
  'SCHEDULED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const TaskPrioritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
export const ExecutionTargetSchema = z.enum(['EDGE', 'CLOUD']);
export const NodeStatusSchema = z.enum(['ONLINE', 'OFFLINE', 'DEGRADED', 'MAINTENANCE']);

export const CreateTaskSchema = z.object({
  name: z.string().min(1).max(200),
  type: TaskTypeSchema,
  priority: TaskPrioritySchema.default('MEDIUM'),
  target: ExecutionTargetSchema.default('EDGE'),
  nodeId: z.string().uuid().optional(),
  input: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  maxRetries: z.number().int().min(0).max(10).default(3),
});

export const TaskIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const TaskListQuerySchema = z.object({
  status: TaskStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const CancelTaskBodySchema = z.object({
  reason: z.string().min(1).max(500).default('Cancelled by user'),
});

export const ScheduleTaskBodySchema = z.object({
  nodeId: z.string().uuid(),
  score: z.number().min(0).max(1),
});

export const CompleteTaskBodySchema = z.object({
  executionTimeMs: z.number().int().min(0),
  cost: z.number().min(0),
  output: z.record(z.unknown()).optional(),
});

export const FailTaskBodySchema = z.object({
  error: z.string().min(1).max(2000),
  retryCount: z.number().int().min(0),
  willRetry: z.boolean(),
});

// Node schemas
export const RegisterNodeSchema = z.object({
  name: z.string().min(1).max(100),
  location: z.string().min(1).max(200),
  region: z.string().min(1).max(50),
  ipAddress: z.string().ip({ version: 'v4' }),
  port: z.number().int().min(1).max(65535),
  cpuCores: z.number().int().min(1).max(128),
  memoryGB: z.number().int().min(1).max(1024),
  storageGB: z.number().int().min(1).max(10000),
  costPerHour: z.number().min(0).max(100).default(0.05),
  maxTasks: z.number().int().min(1).max(1000).default(10),
  bandwidthInMbps: z.number().int().min(1).default(100),
  bandwidthOutMbps: z.number().int().min(1).default(100),
  capabilities: z.array(z.string()).optional(),
  labels: z.record(z.string()).optional(),
});

export const NodeIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const NodeListQuerySchema = z.object({
  status: NodeStatusSchema.optional(),
  region: z.string().optional(),
});

export const NodeMetricsBodySchema = z.object({
  cpuUsage: z.number().min(0).max(100),
  memoryUsage: z.number().min(0).max(100),
  storageUsage: z.number().min(0).max(100),
  latency: z.number().int().min(0),
  tasksRunning: z.number().int().min(0),
});

// Common response schemas
export const ErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.record(z.unknown()).optional(),
});

export const HealthSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  service: z.string(),
  timestamp: z.string().datetime(),
  checks: z.record(z.boolean()).optional(),
  version: z.string().optional(),
});

// Legacy aliases for backward compatibility
export const CreateTaskCommandSchema = CreateTaskSchema;
export const RegisterNodeCommandSchema = RegisterNodeSchema;

// Type exports
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type TaskIdParams = z.infer<typeof TaskIdParamsSchema>;
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;
export type RegisterNodeInput = z.infer<typeof RegisterNodeSchema>;
export type NodeIdParams = z.infer<typeof NodeIdParamsSchema>;
export type NodeListQuery = z.infer<typeof NodeListQuerySchema>;
export type NodeMetricsInput = z.infer<typeof NodeMetricsBodySchema>;
