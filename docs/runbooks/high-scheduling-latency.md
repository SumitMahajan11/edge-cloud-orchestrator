# Runbook: High Scheduling Latency

## ALERT CONDITION

- **Metric**: `edgecloud_api_scheduling_duration_seconds` (p99)
- **Threshold**: `> 0.05s` (50ms) for 5 minutes.
- **Grafana Panel**: "Orchestrator Performance -> Scheduling Latency"

## IMPACT

Users experience delays when submitting new tasks. System throughput is reduced, potentially leading to task backlog and SLA violations.

## DIAGNOSIS STEPS

1. **Check ML Fallback Rate**:
   Identify if the ML model is failing and reverting to rule-based scheduling, which can be slower if high-dimensional.
   - **Query**: `sum(rate(edgecloud_ml_fallback_total[5m]))`
   - **Command**: `kubectl logs -l app=api | grep "ML fallback"`

2. **Check Redis Latency**:
   The scheduler uses Redis for leader election and task queuing. High Redis latency will directly impact scheduling speed.
   - **Command**: `kubectl exec -it redis-0 -- redis-cli --latency`
   - **Query**: `rate(redis_latency_seconds_sum[5m]) / rate(redis_latency_seconds_count[5m])`

3. **Check PostgreSQL Slow Queries**:
   The scheduler queries the `Node` and `Task` tables frequently.
   - **Query**: `SELECT pid, now() - query_start AS duration, query FROM pg_stat_activity WHERE state != 'idle' AND now() - query_start > interval '50 milliseconds' ORDER BY duration DESC;`

4. **Check Node Count**:
   An unexpected spike in node registrations can increase the search space for the scheduler.
   - **Query**: `SELECT count(*) FROM "Node" WHERE status = 'ACTIVE';`

## RESOLUTION

1. **Switch to Rule-Based Mode (Emergency Lever)**:
   If the ML model is suspected to be the bottleneck, force the system into rule-based mode.
   - **Step**: Update the ConfigMap or Environment Variable `ML_SCHEDULING_ENABLED=false` and restart the API pods.
   - **Command**: `kubectl patch deployment api -p '{"spec":{"template":{"spec":{"containers":[{"name":"api","env":[{"name":"ML_SCHEDULING_ENABLED","value":"false"}]}]}}}}'`

2. **Scale API Pods**:
   If the CPU usage is high, increase the number of API replicas to distribute the load (though only the Leader processes the queue, scaling helps with API submission overhead).
   - **Command**: `kubectl scale deployment api --replicas=5`

3. **Flush Task Queue (DANGER)**:
   If the queue is corrupted or extremely long, it might need clearing.
   - **Command**: `kubectl exec -it redis-0 -- redis-cli DEL task:queue`

## ESCALATION

- **Level 2**: Contact Backend Engineering if slow queries persist after database indexing check.
- **Level 3**: Contact Data Science if `ml-scheduler` is consistently slower than the rule-based alternative.

## POST-INCIDENT

- Review `TaskScheduler` logs for `processQueue` duration.
- Audit `Node` table indexes: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_node_status_resources ON "Node"(status, cpu_available, mem_available);`
