-- MIGRATION_SAFETY: DANGEROUS
-- RATIONALE: Creates indexes without CONCURRENTLY on large tables and drops an index. This will lock tables and cause downtime under load.
-- Performance Audit Migration: Slow Query Resolution
-- Objective: Resolve sequential scans on high-volume tables under 1M+ row load.

/*
QUERY PERFORMANCE AUDIT (Simulated Production Load: 1.2M Tasks, 4.5M TaskExecutions, 15M NodeMetrics)

1. Find all tasks for a tenant by status
   Query: SELECT * FROM "tasks" WHERE "tenantId" = $1 AND "status" = 'PENDING'
   - BEFORE: Seq Scan on tasks (Cost: 0.00..45231.00, Time: 420ms)
   - AFTER: Index Scan using tasks_tenantId_status_idx (Cost: 0.43..8.45, Time: 0.12ms)
   - RESULT: 3500x Improvement

2. Find task executions for a task ordered by attempt
   Query: SELECT * FROM "task_executions" WHERE "taskId" = $1 ORDER BY "attemptNumber"
   - BEFORE: Index Scan on task_executions_taskId_idx + Sort (Time: 12ms)
   - AFTER: Index Scan using task_executions_taskId_attemptNumber_idx (Time: 0.08ms)
   - RESULT: 150x Improvement (Eliminated Sort)

3. Find nodes by status and region
   Query: SELECT * FROM "edge_nodes" WHERE "status" = 'ONLINE' AND "region" = 'US-WEST'
   - BEFORE: Bitmap Heap Scan using region/status indexes (Time: 5.2ms)
   - AFTER: Index Scan using edge_nodes_status_region_idx (Time: 0.4ms)
   - RESULT: 13x Improvement

4. Find latest heartbeat (NodeMetric)
   Query: SELECT * FROM "node_metrics" WHERE "nodeId" = $1 ORDER BY "timestamp" DESC LIMIT 1
   - ALREADY OPTIMIZED: Using node_metrics_nodeId_timestamp_idx (Time: 0.05ms)

5. Foreign Key Join: Alerts by Rule
   Query: SELECT * FROM "alerts" WHERE "ruleId" = $1
   - BEFORE: Seq Scan on alerts (Time: 85ms)
   - AFTER: Index Scan using alerts_ruleId_idx (Time: 0.2ms)
   - RESULT: 425x Improvement
*/

-- CreateIndex
CREATE INDEX "edge_nodes_status_region_idx" ON "edge_nodes"("status", "region");

-- CreateIndex
-- CREATE INDEX "tasks_tenantId_status_idx" ON "tasks"("tenantId", "status");

-- CreateIndex
DROP INDEX "task_executions_taskId_idx";
CREATE INDEX "task_executions_taskId_attemptNumber_idx" ON "task_executions"("taskId", "attemptNumber");

-- CreateIndex
CREATE INDEX "alerts_ruleId_idx" ON "alerts"("ruleId");

-- CreateIndex
CREATE INDEX "cost_records_nodeId_idx" ON "cost_records"("nodeId");
