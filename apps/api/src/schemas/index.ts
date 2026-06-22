import { z } from 'zod';

// ============================================
// Auth Schemas
// ============================================

export const registerSchema = z.object({
  email: z.string().email('Invalid email address').trim().toLowerCase(),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters for security')
    .max(128)
    .refine((val) => /[A-Z]/.test(val), {
      message: 'Password must contain at least one uppercase letter',
    })
    .refine((val) => /[a-z]/.test(val), {
      message: 'Password must contain at least one lowercase letter',
    })
    .refine((val) => /[0-9]/.test(val), {
      message: 'Password must contain at least one number',
    })
    .refine((val) => /[^A-Za-z0-9]/.test(val), {
      message: 'Password must contain at least one special character',
    }),
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100)
    .regex(/^[a-zA-Z\s\-\.]+$/, 'Name contains invalid characters'),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const authResponseSchema = z.object({
  token: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string().datetime(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string().optional().nullable(),
    role: z.string(),
  }),
});

export const createApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9\s\-_]+$/, 'API Key name contains invalid characters'),
  permissions: z.array(z.string().trim()).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
});

// ============================================
// Node Schemas
// ============================================

export const createNodeSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9\s\-_]+$/, 'Node name contains invalid characters'),
  location: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9\s\-_,\.]+$/, 'Location contains invalid characters'),
  region: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(
      /^[a-z0-9\-]+$/,
      'Region must be lowercase alphanumeric with hyphens',
    ),
  ipAddress: z.string().ip({ version: 'v4' }),
  port: z.number().int().min(1).max(65535),
  cpuCores: z.number().int().min(1).max(256),
  memoryGB: z.number().int().min(1).max(4096),
  storageGB: z.number().int().min(1).max(100000),
  costPerHour: z.number().min(0).max(1000).optional(),
  maxTasks: z.number().int().min(1).max(5000).optional(),
  bandwidthInMbps: z.number().int().min(1).max(100000).optional(),
  bandwidthOutMbps: z.number().int().min(1).max(100000).optional(),
});

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
});

export const nodeQuerySchema = z.object({
  region: z.string().optional(),
  status: z.enum(['ONLINE', 'OFFLINE', 'DEGRADED', 'MAINTENANCE']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum(['name', 'region', 'status', 'createdAt'])
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ============================================
// Task Schemas
// ============================================

export const createTaskSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9\s\-_]+$/, 'Task name contains invalid characters'),
  type: z.enum([
    'IMAGE_CLASSIFICATION',
    'DATA_AGGREGATION',
    'MODEL_INFERENCE',
    'SENSOR_FUSION',
    'VIDEO_PROCESSING',
    'LOG_ANALYSIS',
    'ANOMALY_DETECTION',
    'DATA_PROCESSING',
    'ETL_PIPELINE',
    'ML_TRAINING',
    'NLP',
    'COMPUTER_VISION',
    'SPEECH_RECOGNITION',
    'RECOMMENDATION_ENGINE',
    'FRAUD_DETECTION',
    'IOT_DATA_INGESTION',
    'REALTIME_ANALYTICS',
    'BATCH_PROCESSING',
    'CONTAINER_BUILD',
    'CICD_PIPELINE',
    'CUSTOM',
  ]),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
  target: z.enum(['EDGE', 'CLOUD', 'HYBRID']).default('EDGE'),
  nodeId: z.string().uuid('Invalid Node ID format').optional(),
  input: z.record(z.string().max(100), z.unknown()).optional(),
  metadata: z.record(z.string().max(100), z.unknown()).optional(),
  maxRetries: z.number().int().min(0).max(20).default(3),
  isDeferrable: z.boolean().optional(),
  maxDelayMinutes: z.number().int().min(0).optional(),
  policy: z.string().optional(),
});

export const updateTaskSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  nodeId: z.string().uuid().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

export const taskQuerySchema = z.object({
  status: z
    .enum([
      'PENDING',
      'SCHEDULED',
      'RUNNING',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
    ])
    .optional(),
  type: z.string().optional(),
  nodeId: z.string().uuid().optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
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
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// ============================================
// Workflow Schemas
// ============================================

export const workflowNodeSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9\-_]+$/, 'Node ID contains invalid characters'),
  name: z.string().trim().min(1).max(100),
  type: z.enum(['task', 'decision', 'parallel', 'wait', 'subworkflow']),
  config: z.record(z.string().max(100), z.unknown()),
  inputs: z.array(z.string().trim()),
  outputs: z.array(z.string().trim()),
});

export const workflowEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  condition: z.string().optional(),
});

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'Version must be semver (e.g., 1.0.0)'),
  nodes: z.array(workflowNodeSchema).min(1),
  edges: z.array(workflowEdgeSchema),
  variables: z.record(z.unknown()).optional(),
  timeout: z.number().int().min(1000).max(86400000).default(60000),
  retryPolicy: z
    .object({
      maxRetries: z.number().int().min(0).max(10).default(3),
      initialDelay: z.number().int().min(100).default(1000),
      maxDelay: z.number().int().min(1000).default(60000),
      multiplier: z.number().min(1).default(2),
    })
    .optional(),
});

export const executeWorkflowSchema = z.object({
  input: z.record(z.unknown()).optional(),
});

// ============================================
// Webhook Schemas
// ============================================

export const createWebhookSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9\s\-_]+$/, 'Webhook name contains invalid characters'),
  url: z
    .string()
    .url()
    .trim()
    .refine(
      (u) => u.startsWith('https://') || process.env.NODE_ENV === 'development',
      {
        message: 'Webhook URL must use HTTPS in production',
      },
    ),
  events: z.array(z.string().trim()).min(1),
  secret: z
    .string()
    .min(32, 'Webhook secret must be at least 32 characters')
    .max(128)
    .optional(),
  enabled: z.boolean().default(true),
});

export const updateWebhookSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  events: z.array(z.string()).min(1).optional(),
  secret: z.string().min(16).max(100).optional(),
  enabled: z.boolean().optional(),
});

// ============================================
// Pagination & Common Schemas
// ============================================

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export const dateRangeSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

// ============================================
// FL Schemas
// ============================================

export const createFLModelSchema = z.object({
  name: z.string().min(1).max(200),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  architecture: z.string().min(1),
  parameters: z.number().int().min(1),
  weightsUrl: z.string().url().optional(),
  weightsSize: z.number().int().min(0).optional(),
});

export const startFLSessionSchema = z.object({
  modelId: z.string().uuid(),
  totalRounds: z.number().int().min(1).max(100).default(10),
  config: z
    .object({
      minClients: z.number().int().min(1).max(100).default(3),
      maxClients: z.number().int().min(1).max(1000).default(10),
      localEpochs: z.number().int().min(1).max(100).default(5),
      learningRate: z.number().min(0.0001).max(1).default(0.01),
      aggregationStrategy: z
        .enum(['fedavg', 'fedprox', 'fedadam'])
        .default('fedavg'),
      privacyBudget: z.number().min(0).max(10).optional(),
      noiseMultiplier: z.number().min(0).max(10).optional(),
      gradientClipNorm: z.number().min(0).max(100).optional(),
    })
    .optional(),
});

// ============================================
// Cost & Carbon Schemas
// ============================================

export const costQuerySchema = z.object({
  nodeId: z.string().uuid().optional(),
  resourceType: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  granularity: z.enum(['hour', 'day', 'week', 'month']).default('day'),
});

export const carbonQuerySchema = z.object({
  region: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  granularity: z.enum(['hour', 'day', 'week', 'month']).default('day'),
});

// ============================================
// Error Schemas
// ============================================

export const ApiErrorSchema = z.object({
  code: z.string().describe('Machine-readable error code'),
  message: z.string().describe('Human-readable error description'),
  requestId: z.string().describe('Unique request ID'),
  timestamp: z.string().datetime().describe('ISO 8601 timestamp'),
  details: z.unknown().optional().describe('Optional error details'),
  stack: z
    .string()
    .optional()
    .describe('Error stack trace (non-production only)'),
});

export const ErrorSchema = ApiErrorSchema;

export const webhooksDeliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const webhooksRedeliverParamSchema = z.object({
  id: z.string().uuid(),
  deliveryId: z.string().uuid(),
});

export const tasksLogsQuerySchema = z.object({
  level: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export const mlDriftHistoryQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(720).optional().default(24),
});

export const resilienceResetParamSchema = z.object({
  name: z.string().min(1),
});

export const schedulerWeightsBodySchema = z.object({
  latency: z.number().min(0).max(1).optional(),
  cpu: z.number().min(0).max(1).optional(),
  memory: z.number().min(0).max(1).optional(),
  cost: z.number().min(0).max(1).optional(),
  network: z.number().min(0).max(1).optional(),
  ml: z.number().min(0).max(1).optional(),
  health: z.number().min(0).max(1).optional(),
});

export const schedulerApplyPresetParamSchema = z.object({
  name: z.string().min(1),
});

export const schedulerDecisionsQuerySchema = z.object({
  nodeId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
});

export const carbonSavingsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(7),
});

export const carbonPolicyUpdateSchema = z.object({
  carbonWeight: z.number().min(0).max(1),
});

export const analyticsCostQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  nodeId: z.string().uuid().optional(),
});

// ============================================
// Admin Schemas
// ============================================

export const adminUserRoleParamSchema = z.object({
  id: z.string().uuid(),
});

export const adminUserRoleBodySchema = z.object({
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER']),
});

export const adminDeactivateParamSchema = z.object({
  id: z.string().uuid(),
});

export const adminCleanupBodySchema = z.object({
  olderThanDays: z.number().int().min(1),
  types: z.array(z.string()),
});

export const adminEventRepublishBodySchema = z.object({
  eventType: z.string(),
  entityId: z.string(),
  targetTopic: z.string().optional(),
});

export const adminEventRepublishRangeBodySchema = z.object({
  eventType: z.string(),
  fromTimestamp: z.string(),
  toTimestamp: z.string(),
  dryRun: z.boolean().optional(),
});

export const adminDlqEventsQuerySchema = z.object({
  topic: z.string().optional(),
  status: z
    .enum(['PENDING', 'RETRYING', 'REPROCESSED', 'PERMANENTLY_FAILED'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const adminDlqEventRetryParamSchema = z.object({
  id: z.string().uuid(),
});

export const adminDlqPurgeBodySchema = z.object({
  olderThanDays: z.number().int().optional(),
});

export const carbonReportQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  tenantId: z.string().uuid().optional(),
  format: z.enum(['json', 'csv']).optional().default('json'),
});
