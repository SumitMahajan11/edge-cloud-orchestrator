import { z } from 'zod'

// ============================================
// Auth Schemas
// ============================================

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
})

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
})

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
})

// ============================================
// Node Schemas
// ============================================

export const createNodeSchema = z.object({
  name: z.string().min(1).max(100),
  location: z.string().min(1).max(200),
  region: z.string().min(1).max(50),
  ipAddress: z.string().ip({ version: 'v4' }),
  port: z.number().int().min(1).max(65535),
  cpuCores: z.number().int().min(1).max(128),
  memoryGB: z.number().int().min(1).max(1024),
  storageGB: z.number().int().min(1).max(10000),
  costPerHour: z.number().min(0).max(100).optional(),
  maxTasks: z.number().int().min(1).max(1000).optional(),
  bandwidthInMbps: z.number().int().min(1).optional(),
  bandwidthOutMbps: z.number().int().min(1).optional(),
})

export const updateNodeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  location: z.string().min(1).max(200).optional(),
  region: z.string().min(1).max(50).optional(),
  cpuCores: z.number().int().min(1).max(128).optional(),
  memoryGB: z.number().int().min(1).max(1024).optional(),
  storageGB: z.number().int().min(1).max(10000).optional(),
  costPerHour: z.number().min(0).max(100).optional(),
  maxTasks: z.number().int().min(1).max(1000).optional(),
  isMaintenanceMode: z.boolean().optional(),
})

export const nodeQuerySchema = z.object({
  region: z.string().optional(),
  status: z.enum(['ONLINE', 'OFFLINE', 'DEGRADED', 'MAINTENANCE']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['name', 'region', 'status', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

// ============================================
// Task Schemas
// ============================================

export const createTaskSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum([
    'IMAGE_CLASSIFICATION',
    'DATA_AGGREGATION',
    'MODEL_INFERENCE',
    'SENSOR_FUSION',
    'VIDEO_PROCESSING',
    'LOG_ANALYSIS',
    'ANOMALY_DETECTION',
    'CUSTOM',
  ]),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
  target: z.enum(['EDGE', 'CLOUD', 'HYBRID']).default('EDGE'),
  nodeId: z.string().uuid().optional(),
  input: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  maxRetries: z.number().int().min(0).max(10).default(3),
})

export const updateTaskSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  nodeId: z.string().uuid().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
})

export const taskQuerySchema = z.object({
  status: z.enum(['PENDING', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
  type: z.string().optional(),
  nodeId: z.string().uuid().optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['submittedAt', 'priority', 'status', 'duration']).default('submittedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

// ============================================
// Workflow Schemas
// ============================================

export const workflowNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['task', 'decision', 'parallel', 'wait', 'subworkflow']),
  config: z.record(z.unknown()),
  inputs: z.array(z.string()),
  outputs: z.array(z.string()),
})

export const workflowEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  condition: z.string().optional(),
})

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be semver (e.g., 1.0.0)'),
  nodes: z.array(workflowNodeSchema).min(1),
  edges: z.array(workflowEdgeSchema),
  variables: z.record(z.unknown()).optional(),
  timeout: z.number().int().min(1000).max(86400000).default(60000),
  retryPolicy: z.object({
    maxRetries: z.number().int().min(0).max(10).default(3),
    initialDelay: z.number().int().min(100).default(1000),
    maxDelay: z.number().int().min(1000).default(60000),
    multiplier: z.number().min(1).default(2),
  }).optional(),
})

export const executeWorkflowSchema = z.object({
  input: z.record(z.unknown()).optional(),
})

// ============================================
// Webhook Schemas
// ============================================

export const createWebhookSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().min(16).max(100).optional(),
  enabled: z.boolean().default(true),
})

export const updateWebhookSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  events: z.array(z.string()).min(1).optional(),
  secret: z.string().min(16).max(100).optional(),
  enabled: z.boolean().optional(),
})

// ============================================
// Pagination & Common Schemas
// ============================================

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const idParamSchema = z.object({
  id: z.string().uuid(),
})

export const dateRangeSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
})

// ============================================
// FL Schemas
// ============================================

export const createFLModelSchema = z.object({
  name: z.string().min(1).max(200),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  architecture: z.string().min(1),
  parameters: z.number().int().min(1),
})

export const startFLSessionSchema = z.object({
  modelId: z.string().uuid(),
  totalRounds: z.number().int().min(1).max(100).default(10),
  config: z.object({
    minClients: z.number().int().min(1).max(100).default(3),
    maxClients: z.number().int().min(1).max(1000).default(10),
    localEpochs: z.number().int().min(1).max(100).default(5),
    learningRate: z.number().min(0.0001).max(1).default(0.01),
    aggregationStrategy: z.enum(['fedavg', 'fedprox', 'fedadam']).default('fedavg'),
    privacyBudget: z.number().min(0).max(10).optional(),
    noiseMultiplier: z.number().min(0).max(10).optional(),
    gradientClipNorm: z.number().min(0).max(100).optional(),
  }).optional(),
})

// ============================================
// Cost & Carbon Schemas
// ============================================

export const costQuerySchema = z.object({
  nodeId: z.string().uuid().optional(),
  resourceType: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  granularity: z.enum(['hour', 'day', 'week', 'month']).default('day'),
})

export const carbonQuerySchema = z.object({
  region: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  granularity: z.enum(['hour', 'day', 'week', 'month']).default('day'),
})
