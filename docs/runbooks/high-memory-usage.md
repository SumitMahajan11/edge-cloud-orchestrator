# Runbook: High Memory Usage (API)

## ALERT CONDITION

- **Metric**: `container_memory_usage_bytes{container="api"}` / `kube_pod_container_resource_limits{container="api"}`
- **Threshold**: `> 0.80` (80%) for 10 minutes.
- **Grafana Panel**: "Infrastructure -> Pod Resources"

## IMPACT

API pods may be OOMKilled by Kubernetes, leading to transient errors, leader re-election cycles, and potential data loss if transactions are interrupted.

## DIAGNOSIS STEPS

1. **Check NodeMetric Table Size**:
   Verify if the database is overwhelmed by metrics, causing the API to cache too much data before flush.
   - **Query**: `SELECT count(*) FROM "NodeMetric";` (If > 1,000,000, retention may be failing)

2. **Check for Interval Leaks**:
   Identify if multiple `setInterval` calls are running due to improper service restarts.
   - **Logs**: `kubectl logs -l app=api | grep "reconcile" | tail -n 100` (Look for high frequency of "Starting reconciliation" logs)

3. **Check Redis Connection Pool**:
   Verify if the number of open Redis connections is growing.
   - **Command**: `kubectl exec -it redis-0 -- redis-cli info clients`

4. **Identify Memory-Intensive Routes**:
   - **Query**: `sum(rate(http_request_duration_seconds_count[5m])) by (route)`

## RESOLUTION

1. **Trigger Rolling Restart**:
   The fastest way to clear a memory leak and restore service.
   - **Command**: `kubectl rollout restart deployment api`

2. **Increase Memory Limits (Temporary)**:
   If the load is legitimate, increase the resource limits.
   - **Command**: `kubectl patch deployment api --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/resources/limits/memory", "value":"2Gi"}]'`

3. **Manual Metric Retention**:
   If `NodeMetric` is too large, manually prune old data.
   - **Query**: `DELETE FROM "NodeMetric" WHERE "timestamp" < now() - interval '24 hours';`

## ESCALATION

- **Level 2**: Contact Backend Engineering if heap usage continues to grow linearly after restart (indicates a persistent leak).
- **Level 3**: Contact Platform Architect if the issue is related to `kafkajs` or `prom-client` registry size.

## POST-INCIDENT

- Run a heap dump to identify leaked objects: `kubectl exec -it <api-pod> -- node --heapsnapshot`
- Verify `shutdownServices` is correctly clearing all intervals.
- Review `MetricsCollector` label cardinality to ensure it's not blowing up memory.
