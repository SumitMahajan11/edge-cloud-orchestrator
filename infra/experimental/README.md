# Experimental Infrastructure

> ⚠️ **NOT FOR PRODUCTION USE**

This directory contains exploratory and future-state infrastructure configurations
that are **NOT** part of the current production deployment.

These files are **NOT** applied in the production environment. Do not reference them from production configurations.
- `docker-compose.yml` or `docker-compose.dev.yml`

## Contents

| Directory       | Status        | Description                                                                                      |
| --------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| `multi-region/` | Future (v2)   | Multi-cloud federation configs (Kafka/CockroachDB era — predates current Redis/PostgreSQL stack) |
| `chaos/`        | Dev tool only | Chaos engineering manifests (LitmusChaos / Chaos Mesh)                                           |

## Note on Technology References

Some files in `multi-region/` reference **Kafka** and **CockroachDB**. These reflect
a previous architecture that was superseded. They are kept for historical
reference only.

**Current production stack uses:**

- **Database**: PostgreSQL 16 (not CockroachDB)
- **Event Bus**: Redis Streams (not Kafka)
- **Leader Election**: Redlock via Redis (not Raft consensus)

## Production Stack Reference

| Component       | Technology           | Location                                      |
| --------------- | -------------------- | --------------------------------------------- |
| Database        | PostgreSQL 16        | Railway Managed Database                      |
| Event Bus       | Redis Streams        | `packages/event-bus/`                         |
| Leader Election | Redlock (Redis)      | `packages/shared-kernel/src/leader-election/` |
| API Gateway     | OpenResty            | `apps/api-gateway/`                           |
| Deployment      | Railway              | Managed via Railway dashboard                |
| Monitoring      | Prometheus + Grafana | `monitoring/`                                 |

## When to Update This Directory

✅ **DO update when:**

- Testing new infrastructure patterns locally
- Exploring future architecture options (v2+)
- Running chaos engineering experiments in dev

❌ **DO NOT update when:**

- Modifying production infrastructure
- Changing backup strategies (use `infra/backup/`)
- Updating service configurations (use `apps/*/` or `packages/*/`)

## Migration History

| Date    | Change                   | Details                                                            |
| ------- | ------------------------ | ------------------------------------------------------------------ |
| 2026-04 | CockroachDB → PostgreSQL | Simplified to single-node PostgreSQL for edge-cloud use case       |
| 2026-04 | Kafka → Redis Streams    | Reduced infrastructure complexity, unified Redis usage             |
| 2026-04 | Raft → Redlock           | Leader election via Redis distributed locks instead of custom Raft |
