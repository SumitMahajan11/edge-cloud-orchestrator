# Disaster Recovery Runbook

This document outlines the procedures for recovering the Edge-Cloud Orchestrator from data loss or total infrastructure failure.

## Recovery Targets

- **RPO** (Recovery Point Objective): 1 hour (Data loss limit)
- **RTO** (Recovery Time Objective): 30 minutes (Downtime limit)

## Nuclear Scenario: Total Cluster Loss

In the event of a total cluster failure, follow these steps in order to rebuild the environment.

### 1. Infrastructure Rebuild (5-10 minutes)

Provision a new Kubernetes cluster and install core infrastructure:

- Ingress Controller (Nginx)
- Secret Management (Vault)
- Persistent Storage Classes

### 2. Database Restoration (10-15 minutes)

Restore PostgreSQL from the latest pgBackRest backup:

1. Deploy `postgres` StatefulSet with recovery parameters.
2. Run pgBackRest restore command:
   ```bash
   pgbackrest --stanza=main --type=immediate restore
   ```
3. Verify data integrity and primary status.

### 3. Redis Restoration (5 minutes)

1. Deploy `redis` Deployment.
2. Download latest AOF backup from S3 to `/data/appendonly.aof`.
3. Start Redis with `appendonly yes`.

### 4. Control Plane Deployment (5 minutes)

1. Deploy `api`, `websocket-gateway`, and `metrics-service`.
2. Verify connectivity to Postgres and Redis.

### 5. Edge Agent Re-registration (Ongoing)

1. Edge agents will automatically attempt to reconnect via mTLS.
2. Monitor `EdgeNode` registry for "ONLINE" status updates.

---

## Verified Restore Procedure (Monthly Test)

We perform an automated restore test monthly to ensure backups are valid.

### Test Steps

1. **Provision Transient Instance**: Deploy a temporary PostgreSQL pod in the `staging` namespace.
2. **Restore Latest Backup**: Use pgBackRest to restore the most recent full/diff backup to the temporary instance.
3. **Data Integrity Check**:
   - Verify row counts for critical tables (`Task`, `EdgeNode`).
   - Check the `timestamp` of the latest record to verify RPO compliance.
4. **Notification**: Success or failure is reported to `#alerts-infrastructure` on Slack.
5. **Cleanup**: Transient storage and pods are deleted.

### Manual Restore Command

If manual restoration is required:

```bash
kubectl exec -it postgres-0 -c pgbackrest -- pgbackrest --stanza=main --type=time "--target=2026-05-01 12:00:00" restore
```
