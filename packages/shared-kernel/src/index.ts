import { injectTraceHeaders } from "./telemetry/propagation.js";
import { getRequestId } from "./logger/context.js";

// Constants
export {
  VERSION,
  REGIONS,
  REDIS_CHANNELS,
  NODE_OFFLINE_THRESHOLD_MS,
  NODE_STALE_THRESHOLD_MS,
  RAFT_DEFAULTS,
  SCHEDULER_CONSTANTS,
  API_CONSTANTS,
} from "./constants.js";
export type { Region } from "./constants.js";

// Types
export type {
  TaskStatus,
  NodeStatus,
  Priority,
  DomainTask,
  DomainNode,
  ScoreWeights,
  HealingAction,
  Alert,
  SystemLoad,
  BackpressureDecision,
} from "./types/domain.js";
export { DEFAULT_SCORE_WEIGHTS } from "./types/domain.js";
export type { ApiError } from "./types/errors.js";

// Domain models
export type {
  EdgeNode,
  NodeMetrics,
  RegisterNodeCommand,
  NodeHealthScore,
} from "./domain/node.js";
export type {
  Task,
  TaskType,
  ExecutionTarget,
  CreateTaskCommand,
  TaskScore,
} from "./domain/task.js";

// Telemetry
export {
  initTelemetry,
  tracer,
  SpanKind,
  SpanStatusCode,
} from "./telemetry/index.js";
export type { Span } from "./telemetry/index.js";
export {
  injectTraceHeaders,
  extractTraceContext,
  withExtractedContext,
} from "./telemetry/propagation.js";

/**
 * Get unified request headers for outgoing calls (OTel + Correlation ID)
 */
export function getRequestHeaders(
  extraHeaders: Record<string, string> = {},
): Record<string, string> {
  const headers = injectTraceHeaders(extraHeaders);
  const requestId = getRequestId();

  if (requestId) {
    headers["x-request-id"] = requestId;
  }

  return headers;
}

// Domain logic
export {
  selectNode,
  calculateNodeScore,
  validateWeights,
  SchedulingError,
} from "./domain/scheduler.js";
export type { SelectNodeOptions, MLPredictor } from "./domain/scheduler.js";
export {
  determineHealingAction,
  shouldRetry,
  calculateRetryDelay,
  processBatchAlerts,
} from "./domain/recovery.js";
export type { RecoveryConfig } from "./domain/recovery.js";
export {
  evaluateBackpressure,
  calculateLoadScore,
} from "./domain/backpressure.js";
export type { BackpressureConfig } from "./domain/backpressure.js";

// Leader Election
export { LeaderElection } from "./leader-election/index.js";
export type {
  LeaderElectionConfig,
  LeaderEvents,
} from "./leader-election/index.js";

export * from "./interfaces/scheduler.js";
export * from "./interfaces/metrics.js";
export * from "./interfaces/event-bus.js";

// Events
export type {
  DomainEvent,
  TaskCreatedEvent,
  TaskScheduledEvent,
  TaskStartedEvent,
  TaskCompletedEvent,
  TaskFailedEvent,
  TaskCancelledEvent,
  NodeRegisteredEvent,
  NodeStatusChangedEvent,
  NodeHeartbeatEvent,
  NodeFailedEvent,
  SchedulingDecisionEvent,
  SystemAlertEvent,
  EdgeCloudEvent,
} from "./events/domain-events.js";

// Utilities
export {
  generateId,
  generateShortId,
  generateEventId,
  generateCorrelationId,
} from "./utils/id-generator.js";
export {
  TaskTypeSchema,
  TaskStatusSchema,
  TaskPrioritySchema,
  ExecutionTargetSchema,
  NodeStatusSchema,
  CreateTaskSchema,
  TaskIdParamsSchema,
  TaskListQuerySchema,
  CancelTaskBodySchema,
  ScheduleTaskBodySchema,
  CompleteTaskBodySchema,
  FailTaskBodySchema,
  RegisterNodeSchema,
  NodeIdParamsSchema,
  NodeListQuerySchema,
  NodeMetricsBodySchema,
  ErrorSchema,
  HealthSchema,
  CreateTaskCommandSchema,
  RegisterNodeCommandSchema,
} from "./utils/validation.js";
export type {
  CreateTaskInput,
  TaskIdParams,
  TaskListQuery,
  RegisterNodeInput,
  NodeIdParams,
  NodeListQuery,
  NodeMetricsInput,
} from "./utils/validation.js";
export { validateRequiredSecrets } from "./utils/secrets-validation.js";
export { RedisFactory } from "./utils/redis-factory.js";

// Secrets Management
export type { SecretManager } from "./secrets/SecretManager.js";
export { SecretManagerFactory } from "./secrets/SecretManagerFactory.js";

// Middleware
export type { AuthUser, AuthConfig } from "./middleware/auth.js";
export {
  createAuthMiddleware,
  requireRole,
  requirePermission,
  requireRegion,
  generateToken,
} from "./middleware/auth.js";

// API Contracts
export * as v1Contracts from "./api-contracts/v1/task.js";
export * as v1NodeContracts from "./api-contracts/v1/node.js";

// Logging
export { createLogger, logger } from "./logger/index.js";
export type { Logger, LoggerConfig } from "./logger/index.js";
export type { LogContext } from "./logger/context.js";
export {
  getRequestId,
  getTraceId,
  getLogContext,
  runWithContext,
  runWithRequestId,
} from "./logger/context.js";
export { fastifyLoggingPlugin } from "./logger/fastify-plugin.js";
export { createExpressLoggingMiddleware } from "./logger/express-middleware.js";

export type { TenantContext } from "./context/tenant.js";
export {
  tenantContext,
  runWithTenantContext,
  enterWithTenantContext,
  getTenantId,
  prismaForTenant,
} from "./context/tenant.js";

export {
  isPrismaConnectionError,
  isPrismaTimeoutError,
  isPrismaPoolExhausted,
  isPrismaNotFound,
  isPrismaConflict,
} from "./db/prisma-errors.js";

// Lifecycle
export { GracefulShutdown } from "./lifecycle/shutdown.js";
export { HealthCheck } from "./lifecycle/health.js";

// Environment validation
export {
  baseEnvSchema,
  validateEnv,
  validateJwtSecret,
} from "./validate-env.js";
export type { BaseEnv } from "./validate-env.js";

export { TaskInputSchema, TaskMetadataSchema } from "./schemas/task.js";

// Invariants
export * from "./invariants/system-invariants.js";

// Permissions
export { Permissions, RolePermissions } from "./auth/permissions.js";
export type { Permission } from "./auth/permissions.js";

// Workflow
export { DAGExecutor } from "./workflow/dag-executor.js";
export type { WorkflowNode } from "./workflow/dag-executor.js";

// SSRF Protection
export {
  validateWebhookUrl,
  validateIpAddress,
} from "./security/ssrf-protection.js";
