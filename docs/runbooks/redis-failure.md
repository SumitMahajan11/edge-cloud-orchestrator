# Redis Sentinel Failover Runbook

This document describes the procedure for managing and testing Redis high-availability failover in the Edge-Cloud Orchestrator Kubernetes environment.

## Architecture Overview

The Redis HA cluster consists of:
- **1 Master**: Primary write node (`redis-master-0`).
- **2 Replicas**: Read-only nodes (`redis-replica-0`, `redis-replica-1`).
- **3 Sentinels**: Monitoring and failover management (`redis-sentinel-0`, `redis-sentinel-1`, `redis-sentinel-2`).

## Manual Failover Test (Simulation)

To verify that the system correctly handles a master failure, follow these steps:

### 1. Identify Current Master
Connect to a sentinel to find the current master:
```bash
kubectl exec -it redis-sentinel-0 -- redis-cli -p 26379 sentinel get-master-addr-by-name mymaster
```

### 2. Simulate Failure
Execute a debug sleep command on the master pod to simulate a non-responsive node:
```bash
kubectl exec -it redis-master-0 -- redis-cli DEBUG SLEEP 30
```

### 3. Monitor Promotion
Watch the sentinel logs to see the failover in action:
```bash
kubectl logs -f redis-sentinel-0
```
Look for `+sdown`, `+odown`, `+try-failover`, and `+switch-master`.

### 4. Verify API Health
The API service should automatically reconnect to the new master via Sentinel. Check API logs:
```bash
kubectl logs -f deployment/api
```
Verify that requests (especially those involving state, like task creation) still succeed.

## Recovery Procedure

If a node is stuck in `OFFLINE` status:
1. Check Pod status: `kubectl get pods -l app=redis`.
2. Restart the pod if necessary: `kubectl delete pod <pod-name>`.
3. Verify replication sync: `kubectl exec -it <pod-name> -- redis-cli info replication`.

## Troubleshooting

### Sentinel Quorum Not Met
If failover doesn't trigger, ensure at least 2 sentinels are online:
```bash
kubectl exec -it redis-sentinel-0 -- redis-cli -p 26379 sentinel ckquorum mymaster
```

### API Connection Issues
Ensure the `REDIS_SENTINELS` environment variable is correctly set in the API deployment:
```yaml
env:
  - name: REDIS_SENTINELS
    value: "redis-sentinel:26379"
```
