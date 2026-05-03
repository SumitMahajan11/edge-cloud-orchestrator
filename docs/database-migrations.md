# Database Migration Guide: Zero-Downtime Patterns

This document outlines the required patterns for database migrations in the Edge-Cloud Orchestrator to ensure zero-downtime deployments.

## The Expand-Contract Pattern

Avoid destructive changes (renames, deletes, NOT NULL additions) in a single step. Use a multi-phase approach.

### 1. Renaming a Column
**Goal:** Rename `old_col` to `new_col`.

*   **Phase 1 (Expand):** 
    *   Add `new_col` as a nullable column in a migration.
    *   Deploy code that writes to BOTH `old_col` and `new_col`.
*   **Phase 2 (Migrate):** 
    *   Run a background script or migration to backfill `new_col` with values from `old_col`.
    *   Update code to read from `new_col` (with fallback to `old_col` if necessary).
*   **Phase 3 (Contract):** 
    *   Deploy code that reads/writes ONLY `new_col`.
    *   Remove `old_col` in a final migration.

### 2. Adding a NOT NULL Column
**Goal:** Add `required_col` to a populated table.

*   **Phase 1:** Add the column as nullable.
*   **Phase 2:** Deploy code that populates the column for new records.
*   **Phase 3:** Backfill existing records with a default or calculated value.
*   **Phase 4:** Add the `NOT NULL` constraint in a migration.

---

## Zero-Downtime Indexing

Large table indexes created with standard `CREATE INDEX` take a full table lock, blocking writes.

### Mandatory Concurrent Creation
All new indexes on tables likely to exceed 100k rows MUST use `CONCURRENTLY`.

```sql
-- DANGEROUS (Locks table)
CREATE INDEX idx_task_status ON "tasks"("status");

-- SAFE (Zero-downtime)
CREATE INDEX CONCURRENTLY idx_task_status ON "tasks"("status");
```

**Note:** Prisma migrations do not support `CONCURRENTLY` out of the box because it cannot run inside a transaction. You must wrap the migration in `-- prisma-migrate-ignore-inventory` or similar, or run it manually.

---

## Migration Classifications

Every migration must be classified with a comment at the top:

*   **SAFE**: Additive changes (new tables, nullable columns, indexes on small tables).
*   **RISKY**: Renames or drops that require coordinated code changes.
*   **DANGEROUS**: Destructive changes or heavy locks on large tables.
