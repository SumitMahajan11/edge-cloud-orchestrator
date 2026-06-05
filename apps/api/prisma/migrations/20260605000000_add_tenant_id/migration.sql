-- CreateEnum
CREATE TYPE "Runtime" AS ENUM ('NATIVE', 'DOCKER', 'WASM');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkflowExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'DEAD_LETTERED');

-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'FAILED_PERMANENT';

-- DropForeignKey
ALTER TABLE "node_metrics_old" DROP CONSTRAINT "node_metrics_nodeId_fkey_old";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_userId_fkey";

-- DropIndex
DROP INDEX "api_keys_key_idx";

-- DropIndex
DROP INDEX "api_keys_key_key";

-- DropIndex
DROP INDEX "edge_nodes_status_idx";

-- DropIndex
DROP INDEX "node_metrics_nodeId_idx";

-- DropIndex
DROP INDEX "node_metrics_timestamp_idx";

-- AlterTable
ALTER TABLE "alert_rules" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "api_keys" DROP COLUMN "key",
ADD COLUMN     "hashedKey" TEXT NOT NULL,
ADD COLUMN     "keyPrefix" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "carbon_metrics" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "cost_records" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "edge_nodes" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "fl_models" DROP COLUMN "weights",
ADD COLUMN     "checksumAlgorithm" TEXT NOT NULL DEFAULT 'SHA-256',
ADD COLUMN     "tenantId" TEXT NOT NULL,
ADD COLUMN     "weightsChecksum" TEXT,
ADD COLUMN     "weightsSize" INTEGER,
ADD COLUMN     "weightsUrl" TEXT;

-- AlterTable
ALTER TABLE "fl_sessions" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "saga_instances" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "saga_steps" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "scheduling_policies" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "task_cost_estimates" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "task_executions" ADD COLUMN     "affinity" TEXT,
ADD COLUMN     "retryOf" TEXT,
ADD COLUMN     "runtime" "Runtime" NOT NULL DEFAULT 'DOCKER',
ADD COLUMN     "tenantId" TEXT NOT NULL,
ADD COLUMN     "traceId" TEXT;

-- AlterTable
ALTER TABLE "task_logs" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "affinity" TEXT,
ADD COLUMN     "image" TEXT,
ADD COLUMN     "runtime" "Runtime" NOT NULL DEFAULT 'DOCKER',
ADD COLUMN     "tenantId" TEXT NOT NULL,
ADD COLUMN     "traceId" TEXT;

-- AlterTable
ALTER TABLE "webhook_deliveries" ADD COLUMN     "nextRetryAt" TIMESTAMP(3),
ADD COLUMN     "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "webhooks" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "workflow_executions" DROP COLUMN "error",
DROP COLUMN "input",
DROP COLUMN "output",
ADD COLUMN     "tenantId" TEXT NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "WorkflowExecutionStatus" NOT NULL DEFAULT 'RUNNING';

-- AlterTable
ALTER TABLE "workflows" DROP COLUMN "isActive",
DROP COLUMN "version",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "status" "WorkflowStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "tenantId" TEXT NOT NULL;

-- DropTable
DROP TABLE "node_metrics_old";

-- DropTable
DROP TABLE "sessions";

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "accessTokenJti" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_task_runs" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stepName" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "workflow_task_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling_decisions" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "selectedNodeId" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "explanation" JSONB NOT NULL,
    "candidateNodes" JSONB NOT NULL,
    "mlModelVersion" TEXT,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "scheduling_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ml_outcome_logs" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "schedulingDecision" JSONB NOT NULL,
    "predictedLatency" DOUBLE PRECISION NOT NULL,
    "actualLatency" DOUBLE PRECISION NOT NULL,
    "predictedCpuUsage" DOUBLE PRECISION NOT NULL,
    "actualCpuUsage" DOUBLE PRECISION NOT NULL,
    "outcome" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ml_outcome_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refreshTokenHash_key" ON "user_sessions"("refreshTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_accessTokenJti_key" ON "user_sessions"("accessTokenJti");

-- CreateIndex
CREATE INDEX "user_sessions_userId_idx" ON "user_sessions"("userId");

-- CreateIndex
CREATE INDEX "user_sessions_refreshTokenHash_idx" ON "user_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "user_sessions_accessTokenJti_idx" ON "user_sessions"("accessTokenJti");

-- CreateIndex
CREATE INDEX "workflow_task_runs_executionId_idx" ON "workflow_task_runs"("executionId");

-- CreateIndex
CREATE INDEX "workflow_task_runs_taskId_idx" ON "workflow_task_runs"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "scheduling_decisions_taskId_key" ON "scheduling_decisions"("taskId");

-- CreateIndex
CREATE INDEX "scheduling_decisions_selectedNodeId_idx" ON "scheduling_decisions"("selectedNodeId");

-- CreateIndex
CREATE INDEX "scheduling_decisions_timestamp_idx" ON "scheduling_decisions"("timestamp");

-- CreateIndex
CREATE INDEX "scheduling_decisions_tenantId_idx" ON "scheduling_decisions"("tenantId");

-- CreateIndex
CREATE INDEX "ml_outcome_logs_taskId_idx" ON "ml_outcome_logs"("taskId");

-- CreateIndex
CREATE INDEX "ml_outcome_logs_nodeId_idx" ON "ml_outcome_logs"("nodeId");

-- CreateIndex
CREATE INDEX "ml_outcome_logs_timestamp_idx" ON "ml_outcome_logs"("timestamp");

-- CreateIndex
CREATE INDEX "alert_rules_tenantId_idx" ON "alert_rules"("tenantId");

-- CreateIndex
CREATE INDEX "alerts_tenantId_idx" ON "alerts"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_hashedKey_key" ON "api_keys"("hashedKey");

-- CreateIndex
CREATE INDEX "api_keys_hashedKey_idx" ON "api_keys"("hashedKey");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_name_userId_key" ON "api_keys"("name", "userId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_idx" ON "audit_logs"("tenantId");

-- CreateIndex
CREATE INDEX "carbon_metrics_tenantId_idx" ON "carbon_metrics"("tenantId");

-- CreateIndex
CREATE INDEX "cost_records_tenantId_idx" ON "cost_records"("tenantId");

-- CreateIndex
CREATE INDEX "edge_nodes_tenantId_idx" ON "edge_nodes"("tenantId");

-- CreateIndex
CREATE INDEX "fl_models_tenantId_idx" ON "fl_models"("tenantId");

-- CreateIndex
CREATE INDEX "fl_sessions_tenantId_idx" ON "fl_sessions"("tenantId");

-- CreateIndex
CREATE INDEX "saga_instances_tenantId_idx" ON "saga_instances"("tenantId");

-- CreateIndex
CREATE INDEX "saga_steps_tenantId_idx" ON "saga_steps"("tenantId");

-- CreateIndex
CREATE INDEX "scheduling_policies_tenantId_idx" ON "scheduling_policies"("tenantId");

-- CreateIndex
CREATE INDEX "task_cost_estimates_tenantId_idx" ON "task_cost_estimates"("tenantId");

-- CreateIndex
CREATE INDEX "task_executions_tenantId_idx" ON "task_executions"("tenantId");

-- CreateIndex
CREATE INDEX "task_logs_tenantId_idx" ON "task_logs"("tenantId");

-- CreateIndex
CREATE INDEX "tasks_tenantId_status_idx" ON "tasks"("tenantId", "status");

-- CreateIndex
CREATE INDEX "webhook_deliveries_tenantId_idx" ON "webhook_deliveries"("tenantId");

-- CreateIndex
CREATE INDEX "webhooks_tenantId_idx" ON "webhooks"("tenantId");

-- CreateIndex
CREATE INDEX "workflow_executions_tenantId_idx" ON "workflow_executions"("tenantId");

-- CreateIndex
CREATE INDEX "workflows_tenantId_idx" ON "workflows"("tenantId");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edge_nodes" ADD CONSTRAINT "edge_nodes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_logs" ADD CONSTRAINT "task_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_task_runs" ADD CONSTRAINT "workflow_task_runs_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "workflow_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_task_runs" ADD CONSTRAINT "workflow_task_runs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling_policies" ADD CONSTRAINT "scheduling_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling_decisions" ADD CONSTRAINT "scheduling_decisions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fl_models" ADD CONSTRAINT "fl_models_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fl_sessions" ADD CONSTRAINT "fl_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_cost_estimates" ADD CONSTRAINT "task_cost_estimates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carbon_metrics" ADD CONSTRAINT "carbon_metrics_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saga_instances" ADD CONSTRAINT "saga_instances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saga_steps" ADD CONSTRAINT "saga_steps_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
