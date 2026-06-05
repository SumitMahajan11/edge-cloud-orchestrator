# ADR 001 — Choose PostgreSQL 16 as Primary Database

**Date:** 2026-04-25  
**Status:** Accepted  
**Category:** Database

## Context

Edge-Cloud Orchestrator needs a relational database for:

- Task state management (lifecycle, scheduling, execution tracking)
- Node registry (edge node metadata, health status, capabilities)
- User data (authentication, roles, sessions)
- Audit logs and compliance records

Two primary options were evaluated:

### PostgreSQL 16

- Mature, battle-tested open-source relational database
- Single primary with optional read replicas
- Rich ecosystem (backup tools, monitoring, extensions like pgvector)
- Familiar to most engineers

### CockroachDB

- Distributed SQL database with automatic sharding
- ACID guarantees across clusters
- Built-in multi-region support
- Higher operational complexity (Gossip protocol, Raft consensus)

## Decision

**We choose PostgreSQL 16 as the primary database.**

### Rationale

1. **Simpler Operational Model**
   - Single primary instance with optional read replicas
   - Well-understood backup/restore procedures (pg_dump, WAL-G, Barman)
   - Straightforward monitoring (pg_stat, Prometheus exporters)

2. **Excellent Performance for Current Scale**
   - Current workload: < 100k queries per second
   - PostgreSQL handles this easily on a single instance
   - Connection pooling via PgBouncer for high concurrency

3. **Rich Ecosystem**
   - Mature backup tools (logical + physical)
   - Extensive monitoring integrations
   - pgvector extension for ML model embeddings (federated learning)
   - JSONB for flexible schema where needed

4. **CockroachDB Complexity Not Justified**
   - Distributed coordination overhead unnecessary at current scale
   - CockroachDB shines at 1M+ concurrent tasks across regions
   - Current architecture doesn't require cross-region ACID transactions

## Consequences

### Positive

- ✅ **Simpler Deployment** — Fewer moving parts, faster provisioning
- ✅ **Faster Development Iteration** — Engineers familiar with PostgreSQL
- ✅ **Lower Operational Costs** — Single instance vs. distributed cluster
- ✅ **Rich Tooling** — Decades of ecosystem maturity

### Negative

- ⚠️ **No Built-in Sharding** — Must shard at application layer if scale exceeds single-server capacity
- ⚠️ **Future Multi-Region Federation** — Will require custom replication (logical replication, CDC tools like Debezium)
- ⚠️ **Vertical Scaling Limits** — Eventually hit ceiling on single-node resources

## Mitigation Strategies

1. **Scaling Beyond Single Node**
   - Implement application-level sharding by region or tenant
   - Use read replicas for query offloading
   - Consider TimescaleDB extension for time-series data (metrics)

2. **High Availability**
   - PostgreSQL streaming replication with automatic failover (Patroni)
   - Regular automated backups with point-in-time recovery (PITR)

3. **Multi-Region Future**
   - Logical replication for cross-region reads
   - Event sourcing pattern for async cross-region writes
   - Evaluate Citus extension for distributed PostgreSQL if needed

## Revisit Triggers

This decision should be revisited when:

- Task queue consistently exceeds 100k pending tasks
- Multi-region deployment becomes a requirement
- Single PostgreSQL instance reaches resource limits (CPU, memory, IOPS)

## Alternatives Considered

- **MySQL 8** — Less advanced JSON support, weaker full-text search
- **CockroachDB** — Over-engineered for current scale, higher complexity
- **MongoDB** — Not suitable for relational data with complex joins

## References

- PostgreSQL 16 Release Notes: https://www.postgresql.org/about/news/postgresql-16-released-2715/
- CockroachDB Architecture: https://www.cockroachlabs.com/docs/stable/architecture/overview.html
- PostgreSQL vs CockroachDB Benchmark: https://www.cockroachlabs.com/blog/postgresql-vs-cockroachdb/
