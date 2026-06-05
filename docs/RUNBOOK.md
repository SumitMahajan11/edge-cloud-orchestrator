# Incident Runbook

This document covers the most common production incidents, how to diagnose them, and how to resolve them. Update this runbook every time a new incident occurs that isn't covered here.

---

## Common Issues and Solutions

### Issue: Nodes not heartbeating (0 online nodes in dashboard)

**Symptoms:** Dashboard shows "0 nodes online" despite agents running on edge nodes.

**Root cause:** Node service can't reach agents, or agents can't reach node service (mTLS misconfiguration, expired certificate, or network policy blocking traffic).

**Diagnosis:**

```bash
# 1. Check node-service logs
kubectl logs -n edgecloud-staging deployment/node-service --tail=100

# 2. Look for mTLS errors
kubectl logs -n edgecloud-staging deployment/node-service | grep -i "certificate verification"

# 3. Check network policies
kubectl get networkpolicies -n edgecloud-staging

# 4. Test connectivity from node-service to an edge node
kubectl exec -it deployment/node-service -n edgecloud-staging -- \
  curl https://EDGE_NODE_IP:9090/health/ready \
  --cacert /var/run/secrets/ca.crt \
  --cert /var/run/secrets/tls.crt \
  --key /var/run/secrets/tls.key
```

**Resolution:**

- If certificate expired → rotate certs (see [Certificate Expiration](#issue-certificate-expiration-imminent) below)
- If network blocked → inspect Ingress/NetworkPolicy rules, check security groups on edge node VMs
- If service misconfigured → check `NODE_SERVICE_URL` in agent config, confirm it matches the actual service endpoint

---

### Issue: Task scheduler not assigning tasks (all tasks stuck in PENDING)

**Symptoms:** Dashboard Tasks page shows all tasks as PENDING; none advance to SCHEDULED or RUNNING.

**Root cause:** `scheduler-service` has crashed, leader election failed, or the ML model failed to load.

**Diagnosis:**

```bash
# 1. Check scheduler-service logs
kubectl logs -n edgecloud-staging deployment/scheduler-service --tail=100

# 2. Check leader-election status
kubectl logs -n edgecloud-staging deployment/scheduler-service | grep -i "leadership"

# 3. Check ML model readiness
kubectl port-forward -n edgecloud-staging svc/scheduler-service 3003:3003
curl http://localhost:3003/health/ready

# 4. Check Redis connection
kubectl logs -n edgecloud-staging deployment/scheduler-service | grep -i "redis" | grep -i "error"
```

**Resolution:**

```bash
# Restart scheduler
kubectl rollout restart deployment/scheduler-service -n edgecloud-staging

# Verify Redis is alive
kubectl exec -n edgecloud-staging deployment/redis -- redis-cli ping
# Expected: PONG

# If ML model weights are corrupted: delete the pod to force re-pull
kubectl delete pod -n edgecloud-staging -l app.kubernetes.io/name=scheduler-service
```

After restart, confirm tasks begin advancing:

```bash
kubectl port-forward -n edgecloud-staging svc/api 3000:3000
curl http://localhost:3000/v1/tasks?status=PENDING
# Count should decrease within 30 seconds
```

---

### Issue: Out of memory (OOM Kill) on task-service

**Symptoms:** Pods crash repeatedly with exit code `137` (SIGKILL from OOM).

**Root cause:** Memory leak in task processing, or replica count too low for current queue load.

**Diagnosis:**

```bash
# 1. Check memory usage across pods
kubectl top pods -n edgecloud-staging

# 2. Check pending task queue length
kubectl port-forward -n edgecloud-staging svc/metrics-service 3005:3005
curl http://localhost:3005/metrics | grep pending_tasks_total

# 3. Check current replica count
kubectl get deployment/task-service -n edgecloud-staging \
  -o jsonpath='{.spec.replicas}'
```

**Resolution:**

```bash
# Scale up replicas immediately to restore capacity
kubectl patch deployment/task-service \
  -p '{"spec":{"replicas":3}}' \
  -n edgecloud-staging

# If memory limits are too low, increase them
kubectl set resources deployment/task-service \
  --limits=memory=1Gi \
  -n edgecloud-staging

# Rolling restart to clear leaked memory in existing pods
kubectl rollout restart deployment/task-service -n edgecloud-staging
```

**Post-incident:** Audit whether `COMPLETED`/`FAILED` tasks are being GC'd from memory. Check `apps/task-service/src/` for task lifecycle cleanup logic.

---

### Issue: Certificate expiration imminent

**Symptoms:** Prometheus alert fires 30 days before expiry; services start rejecting mTLS connections after expiry.

**Root cause:** Manual cert rotation overdue (Vault PKI auto-rotation not yet configured).

**Diagnosis:**

```bash
# Check current cert expiry
kubectl get secret edgecloud-tls -n edgecloud-staging \
  -o jsonpath='{.data.tls\.crt}' | \
  base64 -d | openssl x509 -noout -dates
```

**Resolution:**

```bash
# 1. Issue a new certificate from Vault
vault write pki/issue/edgecloud-services \
  common_name="edgecloud-staging.svc.cluster.local" \
  ttl="8760h"
# Save the certificate and private_key fields to new.crt and new.key

# 2. Create a new Kubernetes TLS secret
kubectl create secret tls edgecloud-tls-new \
  --cert=new.crt \
  --key=new.key \
  -n edgecloud-staging

# 3. Update deployments to reference the new secret
kubectl patch deployment api task-service scheduler-service node-service websocket-gateway \
  -p '{"spec":{"template":{"spec":{"volumes":[{"name":"tls","secret":{"secretName":"edgecloud-tls-new"}}]}}}}' \
  -n edgecloud-staging

# 4. Rolling restart to pick up new secret
kubectl rollout restart deployment -n edgecloud-staging

# 5. Verify all pods are healthy, then delete the old secret
kubectl rollout status deployment -n edgecloud-staging
kubectl delete secret edgecloud-tls -n edgecloud-staging
```

> See also: `scripts/rotate-certs.sh` and `scripts/generate-ca.sh` in the monorepo root for semi-automated cert rotation.

---

### Issue: WebSocket connections dropping (real-time dashboard updates stale)

**Symptoms:** Dashboard stops updating live; refreshing the page temporarily restores updates; WebSocket shows repeated reconnects in browser console.

**Root cause:** `websocket-gateway` pod restarted or was evicted; Redis Streams consumer group fell behind.

**Diagnosis:**

```bash
# Check websocket-gateway pod status
kubectl get pods -n edgecloud-staging -l app.kubernetes.io/name=websocket-gateway

# Check logs for reconnect loops
kubectl logs -n edgecloud-staging deployment/websocket-gateway --tail=100

# Check Redis Streams consumer group lag
kubectl exec -n edgecloud-staging deployment/redis -- \
  redis-cli XINFO GROUPS edgecloud-events
```

**Resolution:**

```bash
# Restart websocket-gateway
kubectl rollout restart deployment/websocket-gateway -n edgecloud-staging

# If Redis Streams consumer group is stuck, trim and recreate
kubectl exec -n edgecloud-staging deployment/redis -- \
  redis-cli XGROUP SETID edgecloud-events websocket-consumers '$'
```

---

### Issue: API returning 503 (service unavailable)

**Symptoms:** All API calls return HTTP 503; health endpoint at `/health/ready` returns unhealthy.

**Root cause:** Database connection pool exhausted, or PostgreSQL is down.

**Diagnosis:**

```bash
# Check API logs
kubectl logs -n edgecloud-staging deployment/api --tail=100 | grep -i "error\|database\|pool"

# Check PostgreSQL pod
kubectl get pods -n edgecloud-staging -l app.kubernetes.io/name=postgres

# Check connection pool metrics
curl http://localhost:3000/metrics | grep db_pool
```

**Resolution:**

```bash
# Restart API to reset connection pool
kubectl rollout restart deployment/api -n edgecloud-staging

# If PostgreSQL is down, check persistent volume
kubectl describe pod -n edgecloud-staging -l app.kubernetes.io/name=postgres

# If PVC is healthy but pod is crash-looping, check init container logs
kubectl logs -n edgecloud-staging -l app.kubernetes.io/name=postgres --previous
```

---

## Escalation Path

| Severity                     | Who to contact                             | When                           |
| ---------------------------- | ------------------------------------------ | ------------------------------ |
| P1 (full outage)             | On-call engineer → Team lead → Ops manager | Immediately                    |
| P2 (degraded, <50% healthy)  | On-call engineer → Team lead               | Within 15 min if not resolving |
| P3 (single service degraded) | On-call engineer                           | Within 1 hour                  |

**Slack channel:** `#oncall`

**Page format:**

```
INCIDENT: <one-line description>
Status: Investigating / Mitigating / Resolved
ETA: <time estimate or Unknown>
Affected: <services/features impacted>
```

---

## Useful kubectl Aliases (paste into shell profile)

```bash
alias kgs='kubectl get pods -n edgecloud-staging'
alias kgp='kubectl get pods -n edgecloud-production'
alias klogs='kubectl logs -n edgecloud-staging'
alias kstage='kubectl -n edgecloud-staging'
alias kprod='kubectl -n edgecloud-production'
```
