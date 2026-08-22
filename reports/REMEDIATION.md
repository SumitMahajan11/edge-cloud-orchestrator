# Remediation Plan: Edge Node CA Certificate Mismatch

## Context
During local testing against the production Neon database, the original `CertificateAuthority` row was deleted and a new CA was generated. The new CA's private key was encrypted using the local `.env`'s `ENCRYPTION_KEY` and inserted into the production database.

This caused two critical issues for production recovery:
1. **API CA Decryption Failure:** The production Railway environment currently has a different `ENCRYPTION_KEY` than the one used to encrypt the new CA. Once Railway comes back online from the 503 outage, the API will crash on startup because it cannot decrypt the CA private key.
2. **Node mTLS Failure:** The 11 real edge nodes registered since July 2026 possess mTLS certificates signed by the *deleted* CA. Any mTLS requests they make will be rejected by the API, which will be validating against the *new* CA.

## Resolution Path 

### Step 1: Fix Railway `ENCRYPTION_KEY`
Before or immediately after Railway unlocks the account, the `ENCRYPTION_KEY` environment variable in Railway must be updated to exactly match the `ENCRYPTION_KEY` present in your local `.env` file. 

This will allow the production API to successfully decrypt the CA private key in the database and boot up without crashing.

### Step 2: Reconciling the 11 Edge Nodes

Because the original CA is deleted, the edge nodes' existing certificates are permanently invalid. You have two options to restore connectivity.

**Option A: Re-bootstrap the Nodes (Recommended)**
Since the old CA is gone, you can issue new certificates by treating the nodes as new deployments.
1. Generate a new `BOOTSTRAP_TOKEN` via the Orchestrator API/UI.
2. Connect to each of the 11 edge nodes physically or via SSH.
3. Remove their old mTLS certificates from their local storage.
4. Re-run the node-agent initialization sequence with the new `BOOTSTRAP_TOKEN` so they can request new certificates signed by the new CA.

**Option B: Neon Database Point-in-Time Recovery (PITR)**
If re-bootstrapping 11 edge nodes manually is unfeasible:
1. Use Neon's Point-in-Time Recovery feature via their dashboard to roll the database back to a point just before the `delete_ca.ts` script was run.
2. This will restore the original `CertificateAuthority` row.
3. You will then need to ensure the Railway `ENCRYPTION_KEY` matches the key that originally encrypted *that* CA.
4. The 11 edge nodes will instantly regain connectivity without needing to touch them.

## Write-Guard Implementation
To prevent accidental production data destruction in the future, a `requireProdConfirm()` guard has been added. Any script under `scripts/` (e.g., `delete_ca.ts`, `seed-geo-nodes.ts`) that mutates the database will now parse the `DATABASE_URL`. If it detects the production Neon host, it will refuse to run unless the `--confirm-prod` flag is appended.
