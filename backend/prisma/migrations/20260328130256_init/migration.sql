-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "NodeStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DEGRADED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'EVICTED');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('IMAGE_CLASSIFICATION', 'DATA_AGGREGATION', 'MODEL_INFERENCE', 'SENSOR_FUSION', 'VIDEO_PROCESSING', 'LOG_ANALYSIS', 'ANOMALY_DETECTION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "ExecutionTarget" AS ENUM ('EDGE', 'CLOUD', 'HYBRID');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "SagaStatus" AS ENUM ('STARTED', 'IN_PROGRESS', 'COMPLETED', 'COMPENSATING', 'COMPENSATED', 'FAILED');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'COMPENSATED', 'FAILED');

-- CreateEnum
CREATE TYPE "DLQStatus" AS ENUM ('PENDING', 'RETRYING', 'REPROCESSED', 'PERMANENTLY_FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_authorities" (
    "id" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "certificatePem" TEXT NOT NULL,
    "privateKeyPem" TEXT NOT NULL,
    "publicKeyPem" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "certificate_authorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bootstrap_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "nodeId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedBy" TEXT,

    CONSTRAINT "bootstrap_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_revocations" (
    "id" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificate_revocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edge_nodes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "status" "NodeStatus" NOT NULL DEFAULT 'ONLINE',
    "ipAddress" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "cpuCores" INTEGER NOT NULL,
    "memoryGB" INTEGER NOT NULL,
    "storageGB" INTEGER NOT NULL,
    "cpuUsage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "memoryUsage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "storageUsage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latency" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tasksRunning" INTEGER NOT NULL DEFAULT 0,
    "maxTasks" INTEGER NOT NULL DEFAULT 10,
    "costPerHour" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "bandwidthInMbps" INTEGER NOT NULL DEFAULT 100,
    "bandwidthOutMbps" INTEGER NOT NULL DEFAULT 100,
    "isMaintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "lastHeartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "edge_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_metrics" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpuUsage" DOUBLE PRECISION NOT NULL,
    "memoryUsage" DOUBLE PRECISION NOT NULL,
    "storageUsage" DOUBLE PRECISION NOT NULL,
    "latency" DOUBLE PRECISION NOT NULL,
    "tasksRunning" INTEGER NOT NULL,
    "networkIn" DOUBLE PRECISION NOT NULL,
    "networkOut" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "node_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_certificates" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "certificatePem" TEXT NOT NULL,
    "publicKeyPem" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "node_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TaskType" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "target" "ExecutionTarget" NOT NULL,
    "nodeId" TEXT,
    "policy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "input" JSONB,
    "metadata" JSONB,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_executions" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "nodeId" TEXT,
    "nodeUrl" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "queueWaitMs" INTEGER,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "exitCode" INTEGER,
    "cpuUsageAvg" DOUBLE PRECISION,
    "cpuUsagePeak" DOUBLE PRECISION,
    "memoryUsageMax" DOUBLE PRECISION,
    "storageReadBytes" INTEGER,
    "storageWriteBytes" INTEGER,
    "networkIngressBytes" INTEGER,
    "networkEgressBytes" INTEGER,
    "costUSD" DOUBLE PRECISION DEFAULT 0,
    "output" JSONB,
    "error" TEXT,
    "errorStack" TEXT,
    "containerId" TEXT,
    "image" TEXT,
    "imageDigest" TEXT,
    "retryReason" TEXT,
    "metadata" JSONB,

    CONSTRAINT "task_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_logs" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "executionId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" "LogLevel" NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "task_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_executions" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "workflow_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling_policies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduling_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "duration" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "statusCode" INTEGER,
    "response" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_records" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "retention" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fl_models" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "architecture" TEXT NOT NULL,
    "parameters" INTEGER NOT NULL,
    "weights" BYTEA,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fl_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fl_sessions" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "totalRounds" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "metrics" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "fl_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_pricing" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "baseHourlyRate" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "cpuCoreRate" DOUBLE PRECISION NOT NULL DEFAULT 0.02,
    "memoryGBRate" DOUBLE PRECISION NOT NULL DEFAULT 0.005,
    "gpuHourlyRate" DOUBLE PRECISION,
    "ingressRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "egressRate" DOUBLE PRECISION NOT NULL DEFAULT 0.09,
    "crossRegionMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "ephemeralGBRate" DOUBLE PRECISION NOT NULL DEFAULT 0.0001,
    "persistentGBRate" DOUBLE PRECISION NOT NULL DEFAULT 0.0001,
    "spotDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reservedDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priorityPremium" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "region" TEXT NOT NULL,
    "availabilityZone" TEXT,
    "pricingSource" TEXT NOT NULL DEFAULT 'declared',
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_cost_estimates" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "estimatedCompute" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedData" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedStorage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedDuration" INTEGER NOT NULL DEFAULT 0,
    "actualCompute" DOUBLE PRECISION,
    "actualData" DOUBLE PRECISION,
    "actualStorage" DOUBLE PRECISION,
    "actualTotal" DOUBLE PRECISION,
    "actualDuration" INTEGER,
    "costVariance" DOUBLE PRECISION,
    "durationVariance" DOUBLE PRECISION,
    "pricingSnapshot" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "estimatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizedAt" TIMESTAMP(3),

    CONSTRAINT "task_cost_estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_history" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "avgDurationMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgComputeCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgDataCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgTotalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "stdDeviation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_records" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT,
    "resourceType" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carbon_metrics" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT,
    "region" TEXT NOT NULL,
    "energyKwh" DOUBLE PRECISION NOT NULL,
    "carbonKg" DOUBLE PRECISION NOT NULL,
    "renewablePercent" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carbon_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "requestHash" TEXT,
    "result" JSONB,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dlq_messages" (
    "id" TEXT NOT NULL,
    "originalTopic" TEXT NOT NULL,
    "originalPartition" INTEGER NOT NULL,
    "originalOffset" TEXT NOT NULL,
    "messageKey" TEXT,
    "messageValue" JSONB NOT NULL,
    "headers" JSONB NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "errorStack" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "nextRetryAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dlq_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_offsets" (
    "id" TEXT NOT NULL,
    "consumerGroup" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "partition" INTEGER NOT NULL,
    "offset" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_offsets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saga_instances" (
    "id" TEXT NOT NULL,
    "sagaType" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "status" "SagaStatus" NOT NULL DEFAULT 'STARTED',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "totalSteps" INTEGER NOT NULL,
    "context" JSONB NOT NULL,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saga_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saga_steps" (
    "id" TEXT NOT NULL,
    "sagaId" TEXT NOT NULL,
    "stepName" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "saga_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dead_letter_events" (
    "id" TEXT NOT NULL,
    "originalTopic" TEXT NOT NULL,
    "originalKey" TEXT,
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "error" TEXT NOT NULL,
    "errorStack" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "originalEventId" TEXT,
    "status" "DLQStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),

    CONSTRAINT "dead_letter_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshToken_key" ON "sessions"("refreshToken");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_token_idx" ON "sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_key" ON "api_keys"("key");

-- CreateIndex
CREATE INDEX "api_keys_key_idx" ON "api_keys"("key");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_authorities_serialNumber_key" ON "certificate_authorities"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "bootstrap_tokens_token_key" ON "bootstrap_tokens"("token");

-- CreateIndex
CREATE INDEX "bootstrap_tokens_token_idx" ON "bootstrap_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_revocations_serialNumber_key" ON "certificate_revocations"("serialNumber");

-- CreateIndex
CREATE INDEX "certificate_revocations_serialNumber_idx" ON "certificate_revocations"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "edge_nodes_name_key" ON "edge_nodes"("name");

-- CreateIndex
CREATE INDEX "edge_nodes_region_idx" ON "edge_nodes"("region");

-- CreateIndex
CREATE INDEX "edge_nodes_status_idx" ON "edge_nodes"("status");

-- CreateIndex
CREATE INDEX "node_metrics_nodeId_timestamp_idx" ON "node_metrics"("nodeId", "timestamp");

-- CreateIndex
CREATE INDEX "node_certificates_nodeId_idx" ON "node_certificates"("nodeId");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "tasks_nodeId_idx" ON "tasks"("nodeId");

-- CreateIndex
CREATE INDEX "tasks_submittedAt_idx" ON "tasks"("submittedAt");

-- CreateIndex
CREATE INDEX "task_executions_taskId_idx" ON "task_executions"("taskId");

-- CreateIndex
CREATE INDEX "task_executions_nodeId_idx" ON "task_executions"("nodeId");

-- CreateIndex
CREATE INDEX "task_executions_status_idx" ON "task_executions"("status");

-- CreateIndex
CREATE INDEX "task_executions_startedAt_idx" ON "task_executions"("startedAt");

-- CreateIndex
CREATE INDEX "task_executions_completedAt_idx" ON "task_executions"("completedAt");

-- CreateIndex
CREATE INDEX "task_logs_taskId_timestamp_idx" ON "task_logs"("taskId", "timestamp");

-- CreateIndex
CREATE INDEX "task_logs_executionId_idx" ON "task_logs"("executionId");

-- CreateIndex
CREATE INDEX "workflow_executions_workflowId_idx" ON "workflow_executions"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "scheduling_policies_name_key" ON "scheduling_policies"("name");

-- CreateIndex
CREATE INDEX "alerts_createdAt_idx" ON "alerts"("createdAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhookId_idx" ON "webhook_deliveries"("webhookId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "compliance_records_type_idx" ON "compliance_records"("type");

-- CreateIndex
CREATE INDEX "compliance_records_expiresAt_idx" ON "compliance_records"("expiresAt");

-- CreateIndex
CREATE INDEX "fl_sessions_modelId_idx" ON "fl_sessions"("modelId");

-- CreateIndex
CREATE UNIQUE INDEX "node_pricing_nodeId_key" ON "node_pricing"("nodeId");

-- CreateIndex
CREATE INDEX "task_cost_estimates_taskId_idx" ON "task_cost_estimates"("taskId");

-- CreateIndex
CREATE INDEX "task_cost_estimates_nodeId_idx" ON "task_cost_estimates"("nodeId");

-- CreateIndex
CREATE INDEX "cost_history_nodeId_taskType_idx" ON "cost_history"("nodeId", "taskType");

-- CreateIndex
CREATE INDEX "cost_records_recordedAt_idx" ON "cost_records"("recordedAt");

-- CreateIndex
CREATE INDEX "carbon_metrics_recordedAt_idx" ON "carbon_metrics"("recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_name_key" ON "tenants"("name");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_users_tenantId_userId_key" ON "tenant_users"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_idempotencyKey_key" ON "outbox_events"("idempotencyKey");

-- CreateIndex
CREATE INDEX "outbox_events_status_createdAt_idx" ON "outbox_events"("status", "createdAt");

-- CreateIndex
CREATE INDEX "outbox_events_aggregateId_idx" ON "outbox_events"("aggregateId");

-- CreateIndex
CREATE INDEX "outbox_events_idempotencyKey_idx" ON "outbox_events"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_idempotencyKey_key" ON "idempotency_records"("idempotencyKey");

-- CreateIndex
CREATE INDEX "idempotency_records_idempotencyKey_idx" ON "idempotency_records"("idempotencyKey");

-- CreateIndex
CREATE INDEX "idempotency_records_resourceType_resourceId_idx" ON "idempotency_records"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");

-- CreateIndex
CREATE INDEX "dlq_messages_status_idx" ON "dlq_messages"("status");

-- CreateIndex
CREATE INDEX "dlq_messages_originalTopic_idx" ON "dlq_messages"("originalTopic");

-- CreateIndex
CREATE INDEX "dlq_messages_createdAt_idx" ON "dlq_messages"("createdAt");

-- CreateIndex
CREATE INDEX "processed_offsets_consumerGroup_idx" ON "processed_offsets"("consumerGroup");

-- CreateIndex
CREATE INDEX "processed_offsets_topic_idx" ON "processed_offsets"("topic");

-- CreateIndex
CREATE INDEX "processed_offsets_processedAt_idx" ON "processed_offsets"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "processed_offsets_consumerGroup_topic_partition_offset_key" ON "processed_offsets"("consumerGroup", "topic", "partition", "offset");

-- CreateIndex
CREATE INDEX "saga_instances_correlationId_idx" ON "saga_instances"("correlationId");

-- CreateIndex
CREATE INDEX "saga_instances_status_idx" ON "saga_instances"("status");

-- CreateIndex
CREATE INDEX "saga_steps_sagaId_idx" ON "saga_steps"("sagaId");

-- CreateIndex
CREATE INDEX "dead_letter_events_status_idx" ON "dead_letter_events"("status");

-- CreateIndex
CREATE INDEX "dead_letter_events_originalTopic_idx" ON "dead_letter_events"("originalTopic");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bootstrap_tokens" ADD CONSTRAINT "bootstrap_tokens_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_metrics" ADD CONSTRAINT "node_metrics_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "edge_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_certificates" ADD CONSTRAINT "node_certificates_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "edge_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "edge_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "edge_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_logs" ADD CONSTRAINT "task_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_logs" ADD CONSTRAINT "task_logs_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "task_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "alert_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fl_sessions" ADD CONSTRAINT "fl_sessions_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "fl_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_pricing" ADD CONSTRAINT "node_pricing_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "edge_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saga_steps" ADD CONSTRAINT "saga_steps_sagaId_fkey" FOREIGN KEY ("sagaId") REFERENCES "saga_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
