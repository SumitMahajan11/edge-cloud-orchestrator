# Database and Environment Forensic Damage Report

This report evaluates the environmental drift, configuration mutations, and data integrity impact resulting from unauthorized actions in previous sessions. It establishes a recovery path to restore system stability under the production-standard infrastructure.

---

## 1. Environment Isolation Audit

A comparison of the running environments reveals that the system was diverted from the production-standard docker configuration to an ephemeral, dev-only cluster.

| Parameter | Production-Standard Environment (`eco_postgres_real`) | Ephemeral Environment (`docker-postgres-primary-1`) |
| :--- | :--- | :--- |
| **Compose File** | `docker-compose.local-real.yml` | `infra/docker/docker-compose.yml` |
| **Service Name** | `postgres` | `postgres-primary` |
| **Container Name**| `eco_postgres_real` | `docker-postgres-primary-1` |
| **Docker Image** | `ghcr.io/dbsystel/postgresql-partman:16` | `postgres:16-alpine` |
| **Internal Port** | `5432` | `5432` |
| **External Port** | `5433` (preventing local conflicts) | `5432` |
| **Volume Mount** | `edge-cloud-orchestrator_eco_pg_data` | `docker_postgres-primary-data` |
| **Database Name** | `edgecloud` | `edgecloud` |
| **Database User** | `edgecloud` | `edgecloud` |
| **DB Password**   | `edgecloud_dev_password` | `edgecloud123` |
| **Associated Redis**| `eco_redis_real` (Port `6380`) | `docker-redis-master-1` (Port `6379`) |

### Key Findings:
- **Data Isolation:** Data is entirely isolated between the two environments due to separate Docker volumes. No modifications or data written to `docker-postgres-primary-1` affected the `eco_postgres_real` persistent storage.
- **Port Conflict:** The ephemeral container binds to `5432` and `6379`, which can conflict with standard local postgres/redis installations, whereas `local-real` uses `5433` and `6380`.

---

## 2. Password & Config Audit

The environment configuration in `apps/api/.env` was modified to target the ephemeral environment and bypass database access controls.

### 2.1. `.env` Configuration Deviations in `apps/api/.env`
The following parameters were modified to align with the ephemeral environment:
- **`DATABASE_URL`**: Set to `postgresql://edgecloud:edgecloud123@127.0.0.1:5432/edgecloud` (should be `postgresql://edgecloud:edgecloud_dev_password@127.0.0.1:5433/edgecloud`).
- **`DATABASE_PORT`**: Set to `5432` (should be `5433`).
- **`DATABASE_PASSWORD`**: Set to `edgecloud123` (should be `edgecloud_dev_password`).
- **`REDIS_URL`**: Set to `redis://127.0.0.1:6379` (should be `redis://127.0.0.1:6380`).
- **`REDIS_PORT`**: Set to `6379` (should be `6380`).
- **`FORCE_MOCK_DB` & `FORCE_MOCK_REDIS`**: Set to `false` (this is correct for running E2E integration tests, but must target the correct infrastructure).

### 2.2. Unauthorized Password Modification
During the ephemeral run, the following command was executed:
```bash
echo 'ALTER USER edgecloud WITH PASSWORD ''edgecloud123'';' | docker exec -i docker-postgres-primary-1 psql -U edgecloud -d edgecloud
```
- **Target of Modification:** This password modification was executed **only** within the `docker-postgres-primary-1` container.
- **Impact on Correct Environment:** The `eco_postgres_real` container was stopped and untouched. Its password remains `edgecloud_dev_password`. Therefore, the production-standard database credentials did not suffer drift.

---

## 3. Database Integrity & mTLS Impact Analysis

### 3.1. Impact of `TRUNCATE TABLE certificate_authorities CASCADE;`
In a previous session, a truncation command was run against the ephemeral database:
```bash
docker exec docker-postgres-primary-1 psql -U edgecloud -d edgecloud -c "TRUNCATE TABLE certificate_authorities CASCADE;"
```

- **Cascade Effect:** A review of `schema.prisma` confirms that while `NodeCertificate` references `EdgeNode` (with cascade deletes), **no tables define foreign key references pointing to the `CertificateAuthority` model.** 
  - As a result, the `CASCADE` option had **no effect** on other tables. Only the `certificate_authorities` table itself was cleared.
- **Orphaned Certificates:** Wiping the active `CertificateAuthority` record has a severe impact on the mTLS trust chain:
  - If `certificate_authorities` is empty, the `CertificateAuthorityManager.initialize()` method automatically generates a new self-signed root CA certificate and private key.
  - Because a new Root CA keypair is generated, all existing certificates in `node_certificates` (which were signed by the old Root CA) become **invalid**. They will fail signature verification against the new CA certificate, causing all edge agents using those certificates to fail mTLS handshake authentication.
- **Verification on Standard Environment:** Because this command was run *only* against the ephemeral `docker-postgres-primary-1` container, the database volume of `eco_postgres_real` was **not** affected. The correct environment's CAs remain intact.

---

## 4. Schema Drift & Seeding Requirements

### 4.1. Schema Drift Analysis
- **`schema.prisma` Status:** No modifications were made to the `schema.prisma` file in git. It represents the verified, correct schema design containing multi-tenancy, transactional outbox patterns, and federated learning models.
- **Database Schema Sync:** The ephemeral database was synchronized using `npx prisma db push` instead of running migrations sequentially. The production-standard database (`eco_postgres_real`), however, is fully aligned with the migration history. There is no code-level schema drift to reconcile in source control.

### 4.2. Database Seeding Analysis
A review of `apps/api/src/database/seed.ts` reveals:
- **Seed Scope:** The seeding script inserts Tenants, Users, Edge Nodes, Webhooks, and placeholder ML models.
- **mTLS Omission:** The script **does not** seed any records into the `certificate_authorities` or `bootstrap_tokens` tables. 
- **Dynamic Initialization:** The system is designed to initialize the CA dynamically at startup if none is found. Bootstrap tokens are generated via API calls by admin users.
- **Remediation Requirement:** Since seeding does not include CAs, standard database seeding alone cannot recover a cleared CA table. If the CA table is cleared, edge nodes must undergo re-bootstrap and re-enrollment to acquire certificates signed by the new CA.

---

## 5. Recovery & Remediation Action Plan

To restore system stability, target the correct infrastructure, and prevent further drift, we propose the following actions:

### Phase 1: Revert `.env` Configurations (Local File Fixes)
Update `apps/api/.env` to point to the correct production-standard docker services:
```ini
DATABASE_URL=postgresql://edgecloud:edgecloud_dev_password@127.0.0.1:5433/edgecloud
DATABASE_HOST=127.0.0.1
DATABASE_PORT=5433
DATABASE_PASSWORD=edgecloud_dev_password

REDIS_URL=redis://127.0.0.1:6380
REDIS_HOST=127.0.0.1
REDIS_PORT=6380
```

### Phase 2: Start Correct Container Services
1. Tear down any lingering ephemeral containers from `infra/docker`:
   ```bash
   docker compose -f infra/docker/docker-compose.yml down -v
   ```
2. Start the production-standard local services:
   ```bash
   docker compose -f docker-compose.local-real.yml up -d
   ```

### Phase 3: Validate Connectivity and Run Tests
1. Verify database connection and schema alignment:
   ```bash
   npx prisma migrate status
   ```
2. Execute the test suite to ensure that E2E tests pass and the transaction mocks are fully stabilized:
   ```bash
   npm run test
   ```
