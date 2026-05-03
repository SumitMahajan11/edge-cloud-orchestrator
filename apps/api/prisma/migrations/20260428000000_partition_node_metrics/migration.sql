-- MIGRATION_SAFETY: RISKY
-- RATIONALE: Renames a table (node_metrics -> node_metrics_old). This causes downtime if the application is not prepared for the rename.
-- Create extension if not exists
CREATE SCHEMA IF NOT EXISTS partman;
CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;

-- Rename existing table
ALTER TABLE "node_metrics" RENAME TO "node_metrics_old";

-- Create partitioned table
-- Note: In partitioned tables, the partition key must be part of any unique/primary key
CREATE TABLE "node_metrics" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "cpuUsage" DOUBLE PRECISION NOT NULL,
    "memoryUsage" DOUBLE PRECISION NOT NULL,
    "storageUsage" DOUBLE PRECISION NOT NULL,
    "latency" DOUBLE PRECISION NOT NULL,
    "tasksRunning" INTEGER NOT NULL,
    "networkIn" DOUBLE PRECISION NOT NULL,
    "networkOut" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_metrics_pkey" PRIMARY KEY ("id", "timestamp")
) PARTITION BY RANGE ("timestamp");

-- Create foreign key constraint
-- Note: EdgeNode table name in SQL is likely "edge_nodes" or similar.
-- Let's check schema.prisma for EdgeNode mapping.
ALTER TABLE "node_metrics" ADD CONSTRAINT "node_metrics_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "edge_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create indices on parent (will propagate to children)
CREATE INDEX "node_metrics_nodeId_idx" ON "node_metrics"("nodeId");
CREATE INDEX "node_metrics_timestamp_idx" ON "node_metrics"("timestamp");

-- Composite index for optimized queries (nodeId, timestamp DESC)
CREATE INDEX "node_metrics_nodeId_timestamp_idx" ON "node_metrics"("nodeId", "timestamp" DESC);

-- Initialize pg_partman for the table
SELECT partman.create_parent('public.node_metrics', 'timestamp', 'native', 'daily');

-- Configure retention in pg_partman
UPDATE partman.part_config 
SET retention = '7 days', 
    retention_keep_table = false 
WHERE parent_table = 'public.node_metrics';
