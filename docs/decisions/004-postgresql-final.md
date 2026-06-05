# ADR 004: Standardization on PostgreSQL 15

## Status

Accepted

## Context

The Edge-Cloud Orchestrator was initially designed to support both PostgreSQL and CockroachDB. During the development of version 3.5.0, a migration to CockroachDB was initiated to support multi-region scaling and distributed transactions. However, the added complexity of CockroachDB's consensus layer and the operational overhead of managing a CRDB cluster outweighed the benefits for the current scale of the project. Furthermore, several CockroachDB-specific syntax requirements and different behaviors (e.g., SERIAL vs. UUID handling) introduced fragility into the Prisma-based ORM layer.

## Decision

We will standardize on **PostgreSQL 15** as the primary and definitive database for the Edge-Cloud Orchestrator.

Key technical implications:

1. **Infrastructure**: Revert all CockroachDB service definitions in `docker-compose` and Kubernetes manifests to standard PostgreSQL 15.
2. **Schema**: Maintain a single, pure-PostgreSQL Prisma schema.
3. **ORM**: Ensure all database interactions are compatible with standard PostgreSQL features.
4. **Multi-Region**: Future multi-region requirements will be handled via PostgreSQL logical replication or managed cloud offerings (RDS/Aurora) rather than a self-managed CockroachDB cluster.
5. **Port**: Standardize on port `5432` across all environments.

## Consequences

- **Positive**: Simplified local development, lower resource overhead for the infrastructure stack, and broader compatibility with standard tooling.
- **Negative**: Reversion of native multi-master capabilities provided by CockroachDB; multi-region deployments will require more manual configuration of replication.
- **Neutral**: Existing Prisma migrations are already largely compatible and do not require major rewrites.

## Verification

- Validated `apps/api/prisma/schema.prisma` against PostgreSQL 15.
- Verified all microservices `depends_on` and `DATABASE_URL` point to PostgreSQL.
- Performed a clean validation of the Prisma schema.
