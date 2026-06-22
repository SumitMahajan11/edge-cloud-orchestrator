
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}



/**
 * Enums
 */

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  Serializable: 'Serializable'
});

exports.Prisma.UserScalarFieldEnum = {
  id: 'id',
  email: 'email',
  passwordHash: 'passwordHash',
  name: 'name',
  role: 'role',
  isActive: 'isActive',
  emailVerified: 'emailVerified',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  lastLoginAt: 'lastLoginAt'
};

exports.Prisma.TenantScalarFieldEnum = {
  id: 'id',
  name: 'name',
  slug: 'slug',
  config: 'config',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SchedulingPolicyScalarFieldEnum = {
  id: 'id',
  name: 'name',
  type: 'type',
  config: 'config',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  tenantId: 'tenantId'
};

exports.Prisma.TenantUserScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  userId: 'userId',
  role: 'role',
  createdAt: 'createdAt'
};

exports.Prisma.MetricRetentionPolicyScalarFieldEnum = {
  id: 'id',
  tenantId: 'tenantId',
  retentionDays: 'retentionDays',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.UserSessionScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  refreshTokenHash: 'refreshTokenHash',
  accessTokenJti: 'accessTokenJti',
  ipAddress: 'ipAddress',
  userAgent: 'userAgent',
  revoked: 'revoked',
  createdAt: 'createdAt',
  lastUsedAt: 'lastUsedAt',
  expiresAt: 'expiresAt'
};

exports.Prisma.ApiKeyScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  name: 'name',
  keyPrefix: 'keyPrefix',
  hashedKey: 'hashedKey',
  permissions: 'permissions',
  expiresAt: 'expiresAt',
  createdAt: 'createdAt',
  lastUsedAt: 'lastUsedAt'
};

exports.Prisma.WebhookScalarFieldEnum = {
  id: 'id',
  name: 'name',
  url: 'url',
  events: 'events',
  secret: 'secret',
  enabled: 'enabled',
  createdAt: 'createdAt',
  tenantId: 'tenantId'
};

exports.Prisma.WebhookDeliveryScalarFieldEnum = {
  id: 'id',
  webhookId: 'webhookId',
  event: 'event',
  payload: 'payload',
  statusCode: 'statusCode',
  response: 'response',
  deliveredAt: 'deliveredAt',
  retryCount: 'retryCount',
  status: 'status',
  nextRetryAt: 'nextRetryAt',
  createdAt: 'createdAt',
  tenantId: 'tenantId'
};

exports.Prisma.AuditLogScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  action: 'action',
  entityType: 'entityType',
  entityId: 'entityId',
  details: 'details',
  ipAddress: 'ipAddress',
  userAgent: 'userAgent',
  createdAt: 'createdAt',
  tenantId: 'tenantId'
};

exports.Prisma.EdgeNodeScalarFieldEnum = {
  id: 'id',
  name: 'name',
  location: 'location',
  region: 'region',
  status: 'status',
  ipAddress: 'ipAddress',
  port: 'port',
  url: 'url',
  cpuCores: 'cpuCores',
  memoryGB: 'memoryGB',
  storageGB: 'storageGB',
  cpuUsage: 'cpuUsage',
  memoryUsage: 'memoryUsage',
  storageUsage: 'storageUsage',
  latency: 'latency',
  tasksRunning: 'tasksRunning',
  maxTasks: 'maxTasks',
  latitude: 'latitude',
  longitude: 'longitude',
  costPerHour: 'costPerHour',
  carbonIntensity: 'carbonIntensity',
  bandwidthInMbps: 'bandwidthInMbps',
  bandwidthOutMbps: 'bandwidthOutMbps',
  isMaintenanceMode: 'isMaintenanceMode',
  lastHeartbeat: 'lastHeartbeat',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  version: 'version',
  tenantId: 'tenantId'
};

exports.Prisma.TaskScalarFieldEnum = {
  id: 'id',
  name: 'name',
  type: 'type',
  status: 'status',
  priority: 'priority',
  target: 'target',
  nodeId: 'nodeId',
  policy: 'policy',
  reason: 'reason',
  runtime: 'runtime',
  image: 'image',
  wasmArtifactId: 'wasmArtifactId',
  affinity: 'affinity',
  traceId: 'traceId',
  isDeferrable: 'isDeferrable',
  maxDelayMinutes: 'maxDelayMinutes',
  maxDurationSeconds: 'maxDurationSeconds',
  maxRetries: 'maxRetries',
  input: 'input',
  metadata: 'metadata',
  submittedAt: 'submittedAt',
  tenantId: 'tenantId'
};

exports.Prisma.TaskExecutionScalarFieldEnum = {
  id: 'id',
  taskId: 'taskId',
  attemptNumber: 'attemptNumber',
  nodeId: 'nodeId',
  nodeUrl: 'nodeUrl',
  runtime: 'runtime',
  wasmArtifactId: 'wasmArtifactId',
  affinity: 'affinity',
  traceId: 'traceId',
  scheduledAt: 'scheduledAt',
  startedAt: 'startedAt',
  completedAt: 'completedAt',
  durationMs: 'durationMs',
  status: 'status',
  exitCode: 'exitCode',
  error: 'error',
  costUSD: 'costUSD',
  retryOf: 'retryOf',
  retryReason: 'retryReason',
  tenantId: 'tenantId',
  createdAt: 'createdAt'
};

exports.Prisma.TaskLogScalarFieldEnum = {
  id: 'id',
  taskId: 'taskId',
  level: 'level',
  message: 'message',
  timestamp: 'timestamp',
  tenantId: 'tenantId'
};

exports.Prisma.CertificateAuthorityScalarFieldEnum = {
  id: 'id',
  serialNumber: 'serialNumber',
  certificatePem: 'certificatePem',
  privateKeyPem: 'privateKeyPem',
  publicKeyPem: 'publicKeyPem',
  issuedAt: 'issuedAt',
  expiresAt: 'expiresAt',
  isActive: 'isActive'
};

exports.Prisma.NodeMetricScalarFieldEnum = {
  id: 'id',
  nodeId: 'nodeId',
  tenantId: 'tenantId',
  createdAt: 'createdAt',
  timestamp: 'timestamp',
  cpuUsage: 'cpuUsage',
  memoryUsage: 'memoryUsage',
  storageUsage: 'storageUsage',
  latency: 'latency',
  tasksRunning: 'tasksRunning',
  networkIn: 'networkIn',
  networkOut: 'networkOut'
};

exports.Prisma.SagaInstanceScalarFieldEnum = {
  id: 'id',
  sagaType: 'sagaType',
  correlationId: 'correlationId',
  status: 'status',
  currentStep: 'currentStep',
  totalSteps: 'totalSteps',
  context: 'context',
  error: 'error',
  startedAt: 'startedAt',
  completedAt: 'completedAt',
  updatedAt: 'updatedAt',
  tenantId: 'tenantId'
};

exports.Prisma.SagaStepScalarFieldEnum = {
  id: 'id',
  sagaId: 'sagaId',
  stepName: 'stepName',
  stepOrder: 'stepOrder',
  status: 'status',
  input: 'input',
  output: 'output',
  error: 'error',
  attempts: 'attempts',
  startedAt: 'startedAt',
  completedAt: 'completedAt',
  tenantId: 'tenantId'
};

exports.Prisma.SchedulingDecisionScalarFieldEnum = {
  id: 'id',
  taskId: 'taskId',
  timestamp: 'timestamp',
  selectedNodeId: 'selectedNodeId',
  policy: 'policy',
  score: 'score',
  explanation: 'explanation',
  candidateNodes: 'candidateNodes',
  mlModelVersion: 'mlModelVersion',
  fallbackUsed: 'fallbackUsed',
  tenantId: 'tenantId'
};

exports.Prisma.OutcomeLogScalarFieldEnum = {
  id: 'id',
  taskId: 'taskId',
  nodeId: 'nodeId',
  schedulingDecision: 'schedulingDecision',
  predictedLatency: 'predictedLatency',
  actualLatency: 'actualLatency',
  predictedCpuUsage: 'predictedCpuUsage',
  actualCpuUsage: 'actualCpuUsage',
  outcome: 'outcome',
  timestamp: 'timestamp'
};

exports.Prisma.IdempotencyRecordScalarFieldEnum = {
  id: 'id',
  idempotencyKey: 'idempotencyKey',
  resourceType: 'resourceType',
  resourceId: 'resourceId',
  requestHash: 'requestHash',
  result: 'result',
  status: 'status',
  createdAt: 'createdAt',
  expiresAt: 'expiresAt'
};

exports.Prisma.CostRecordScalarFieldEnum = {
  id: 'id',
  nodeId: 'nodeId',
  resourceType: 'resourceType',
  amount: 'amount',
  unit: 'unit',
  cost: 'cost',
  currency: 'currency',
  recordedAt: 'recordedAt',
  tenantId: 'tenantId'
};

exports.Prisma.CarbonMetricScalarFieldEnum = {
  id: 'id',
  nodeId: 'nodeId',
  region: 'region',
  energyKwh: 'energyKwh',
  carbonKg: 'carbonKg',
  renewablePercent: 'renewablePercent',
  recordedAt: 'recordedAt',
  tenantId: 'tenantId'
};

exports.Prisma.CarbonRecordScalarFieldEnum = {
  id: 'id',
  taskId: 'taskId',
  tenantId: 'tenantId',
  nodeId: 'nodeId',
  region: 'region',
  carbonIntensity: 'carbonIntensity',
  durationMs: 'durationMs',
  estimatedGco2eq: 'estimatedGco2eq',
  estimatedWatts: 'estimatedWatts',
  wasDeferred: 'wasDeferred',
  baselineGco2eq: 'baselineGco2eq',
  carbonSavedGco2eq: 'carbonSavedGco2eq',
  recordedAt: 'recordedAt'
};

exports.Prisma.NodeHealthScoreScalarFieldEnum = {
  id: 'id',
  nodeId: 'nodeId',
  tenantId: 'tenantId',
  successRate: 'successRate',
  avgLatencyMs: 'avgLatencyMs',
  latencyDeviation: 'latencyDeviation',
  anomalyScore: 'anomalyScore',
  isAnomaly: 'isAnomaly',
  penaltyMultiplier: 'penaltyMultiplier',
  updatedAt: 'updatedAt'
};

exports.Prisma.SchedulingOutcomeScalarFieldEnum = {
  id: 'id',
  taskId: 'taskId',
  nodeId: 'nodeId',
  tenantId: 'tenantId',
  assignedAt: 'assignedAt',
  completedAt: 'completedAt',
  status: 'status',
  actualLatencyMs: 'actualLatencyMs',
  predictedLatencyMs: 'predictedLatencyMs',
  carbonIntensityAtAssignment: 'carbonIntensityAtAssignment',
  nodeLoadAtAssignment: 'nodeLoadAtAssignment',
  rewardScore: 'rewardScore',
  createdAt: 'createdAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};


exports.Prisma.ModelName = {
  User: 'User',
  Tenant: 'Tenant',
  SchedulingPolicy: 'SchedulingPolicy',
  TenantUser: 'TenantUser',
  MetricRetentionPolicy: 'MetricRetentionPolicy',
  UserSession: 'UserSession',
  ApiKey: 'ApiKey',
  Webhook: 'Webhook',
  WebhookDelivery: 'WebhookDelivery',
  AuditLog: 'AuditLog',
  EdgeNode: 'EdgeNode',
  Task: 'Task',
  TaskExecution: 'TaskExecution',
  TaskLog: 'TaskLog',
  CertificateAuthority: 'CertificateAuthority',
  NodeMetric: 'NodeMetric',
  SagaInstance: 'SagaInstance',
  SagaStep: 'SagaStep',
  SchedulingDecision: 'SchedulingDecision',
  OutcomeLog: 'OutcomeLog',
  IdempotencyRecord: 'IdempotencyRecord',
  CostRecord: 'CostRecord',
  CarbonMetric: 'CarbonMetric',
  CarbonRecord: 'CarbonRecord',
  NodeHealthScore: 'NodeHealthScore',
  SchedulingOutcome: 'SchedulingOutcome'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
