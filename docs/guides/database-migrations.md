# Database Migration Strategy

This guide defines the standards and workflows for managing PostgreSQL database migrations in the Edge-Cloud Orchestrator project using Prisma.

## Core Principles

1.  **CI-First**: All migrations must be applied through the CI/CD pipeline using `prisma migrate deploy`. Local development uses `prisma migrate dev`.
2.  **Immutability**: Once a migration is committed to the repository, it must never be modified.
3.  **Zero-Downtime**: All schema changes must be designed to allow the application to remain functional during the migration process.
4.  **Rollback Readiness**: Every migration PR must include a `down.sql` or `rollback.sql` script.

---

## Migration Workflow

### 1. Development
- Create migrations using `prisma migrate dev --name <description>`.
- Review the generated `.sql` file in `prisma/migrations/`.

### 2. Pull Request
Every PR that touches `schema.prisma` or `prisma/migrations/` MUST include:
- A preview of the change (`prisma migrate diff`).
- A `down.sql` script in the same migration directory.
- An estimated lock duration for the migration (documented in the PR description).
- **Mandatory Peer Review**: At least one other engineer must review the SQL impact.

### 3. CI/CD Pipeline
- **Dry Run**: CI spins up a fresh Postgres, applies all migrations, and verifies the schema match.
- **Backup**: CD triggers a `pg_dump` before applying any migration in production.
- **Health Gates**: Connection checks and migration status verification are performed pre and post-migration.

---

## Zero-Downtime Patterns

### 1. Adding a Column
**Incorrect**: Adding a `NOT NULL` column with a default value. This can cause long locks on large tables.
**Correct (3 steps)**:
1.  Add the column as **nullable**.
2.  Deploy and backfill data in chunks.
3.  Add the `NOT NULL` constraint in a separate migration.

### 2. Renaming a Column
**Incorrect**: Renaming a column in Prisma. This generates an `ALTER TABLE ... RENAME COLUMN`, which causes locks and breaks the current running app.
**Correct (Dual-Write)**:
1.  **Add New Column**: Add the new column as nullable.
2.  **Dual-Write**: Update application code to write to both the old and new columns.
3.  **Backfill**: Sync existing data from the old column to the new column.
4.  **Switch Reads**: Update code to read from the new column.
5.  **Clean Up**: Delete the old column.

### 3. Adding an Index
**Incorrect**: `CREATE INDEX`. This locks the table for writes.
**Correct**: Always use `CREATE INDEX CONCURRENTLY`.
> [!NOTE]
> Prisma's `@@index` doesn't support `CONCURRENTLY` natively in `migrate dev`. You must manually edit the SQL file to add `CONCURRENTLY` and ensure the migration is wrapped in `COMMIT;` effectively running outside a transaction if using Postgres specific features.

---

## Troubleshooting

### Failed Migrations
If a migration fails in production:
1.  **Alert**: The CD pipeline will fail and alert the Ops team.
2.  **Analyze**: Check the `_prisma_migrations` table to identify the failed migration.
3.  **Resolve**: 
    -   If the DB is in a consistent state, fix the root cause and re-run.
    -   If inconsistent, use the `down.sql` script to revert manually and restore from the pre-migration backup if necessary.
4.  **Log**: Update the `_prisma_migrations` table state if `resolve` is used.
