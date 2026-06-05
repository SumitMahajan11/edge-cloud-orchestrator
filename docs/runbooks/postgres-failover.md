# Postgres Failover Runbook

This document describes the procedure for managing and recovering from a PostgreSQL failure in the Kubernetes environment.

## 1. Verifying Replication Status

Before performing any manual failover, verify the replication status and lag.

### Check Replication from Primary

```bash
kubectl exec -it postgres-0 -- psql -U postgres -c "select * from pg_stat_replication;"
```

### Check Replication from Replica

```bash
kubectl exec -it postgres-1 -- psql -U postgres -c "select pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn(), pg_last_xact_replay_timestamp();"
```

## 2. Promoting a Replica

If the primary (`postgres-0`) is unavailable and cannot be recovered quickly, promote the replica (`postgres-1`).

### Step 1: Promote the Replica

```bash
kubectl exec -it postgres-1 -- pg_ctl promote
```

Verify it is now in read-write mode:

```bash
kubectl exec -it postgres-1 -- psql -U postgres -c "select pg_is_in_recovery();"
# Should return 'f' (false)
```

### Step 2: Update the Primary Service Selector

Update the `postgres-primary` service to point to `postgres-1` temporarily.

```bash
kubectl patch svc postgres-primary -p '{"spec":{"selector":{"statefulset.kubernetes.io/pod-name": "postgres-1"}}}'
```

## 3. Re-establishing HA

Once the original primary (`postgres-0`) is healthy again, it must be re-added as a replica of the current primary (`postgres-1`).

### Step 1: Delete Data on Old Primary

```bash
kubectl exec -it postgres-0 -- rm -rf /bitnami/postgresql/data/*
```

### Step 2: Sync from New Primary

You can manually trigger a `pg_basebackup` or restart the pod to let the `initContainer` handle it (ensure the `initContainer` logic supports syncing from `postgres-1`).

### Step 3: Revert Service Selector (Optional)

Once synchronization is complete and you want to fail back to pod 0:

1. Promote `postgres-0`.
2. Update service selector back to `postgres-0`.
3. Set up `postgres-1` as a replica again.

## 4. Troubleshooting

### Connection Pool Exhaustion

If PgBouncer is reaching its limit, check the number of active connections:

```bash
kubectl exec -it <api-pod> -c pgbouncer -- psql -p 5432 -h localhost -U postgres -d pgbouncer -c "SHOW CLIENTS;"
```

Increase `PGBOUNCER_MAX_CLIENT_CONN` in the API deployment if necessary.
