/*
  Warnings:

  - Added the required column `tenantId` to the `node_metrics` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "edge_nodes" ADD COLUMN     "carbonIntensity" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "node_metrics" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "task_executions" ADD COLUMN     "wasmArtifactId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "isDeferrable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxDelayMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "wasmArtifactId" TEXT;

-- CreateTable
CREATE TABLE "federated_rounds" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "minParticipants" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "federated_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "federated_weight_submissions" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "weightsUrl" TEXT NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "avgReward" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "federated_weight_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carbon_records" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "carbonIntensity" DOUBLE PRECISION NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "estimatedGco2eq" DOUBLE PRECISION NOT NULL,
    "estimatedWatts" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "wasDeferred" BOOLEAN NOT NULL DEFAULT false,
    "baselineGco2eq" DOUBLE PRECISION,
    "carbonSavedGco2eq" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carbon_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_retention_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_health_scores" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "successRate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "avgLatencyMs" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "latencyDeviation" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "anomalyScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "isAnomaly" BOOLEAN NOT NULL DEFAULT false,
    "penaltyMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "node_health_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling_outcomes" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "actualLatencyMs" INTEGER,
    "predictedLatencyMs" INTEGER NOT NULL,
    "carbonIntensityAtAssignment" DOUBLE PRECISION NOT NULL,
    "nodeLoadAtAssignment" DOUBLE PRECISION NOT NULL,
    "rewardScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduling_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "federated_rounds_tenantId_idx" ON "federated_rounds"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "federated_rounds_modelId_roundNumber_key" ON "federated_rounds"("modelId", "roundNumber");

-- CreateIndex
CREATE INDEX "federated_weight_submissions_roundId_idx" ON "federated_weight_submissions"("roundId");

-- CreateIndex
CREATE INDEX "federated_weight_submissions_nodeId_idx" ON "federated_weight_submissions"("nodeId");

-- CreateIndex
CREATE INDEX "federated_weight_submissions_tenantId_idx" ON "federated_weight_submissions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "federated_weight_submissions_roundId_nodeId_key" ON "federated_weight_submissions"("roundId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "carbon_records_taskId_key" ON "carbon_records"("taskId");

-- CreateIndex
CREATE INDEX "carbon_records_tenantId_recordedAt_idx" ON "carbon_records"("tenantId", "recordedAt");

-- CreateIndex
CREATE INDEX "carbon_records_taskId_idx" ON "carbon_records"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "metric_retention_policies_tenantId_key" ON "metric_retention_policies"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "node_health_scores_nodeId_key" ON "node_health_scores"("nodeId");

-- CreateIndex
CREATE INDEX "node_health_scores_tenantId_idx" ON "node_health_scores"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "scheduling_outcomes_taskId_key" ON "scheduling_outcomes"("taskId");

-- CreateIndex
CREATE INDEX "scheduling_outcomes_taskId_idx" ON "scheduling_outcomes"("taskId");

-- CreateIndex
CREATE INDEX "scheduling_outcomes_nodeId_idx" ON "scheduling_outcomes"("nodeId");

-- CreateIndex
CREATE INDEX "scheduling_outcomes_tenantId_idx" ON "scheduling_outcomes"("tenantId");

-- CreateIndex
CREATE INDEX "node_metrics_tenantId_createdAt_idx" ON "node_metrics"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "node_metrics" ADD CONSTRAINT "node_metrics_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "federated_rounds" ADD CONSTRAINT "federated_rounds_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "federated_weight_submissions" ADD CONSTRAINT "federated_weight_submissions_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "federated_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "federated_weight_submissions" ADD CONSTRAINT "federated_weight_submissions_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "edge_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "federated_weight_submissions" ADD CONSTRAINT "federated_weight_submissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carbon_records" ADD CONSTRAINT "carbon_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_retention_policies" ADD CONSTRAINT "metric_retention_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling_outcomes" ADD CONSTRAINT "scheduling_outcomes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
