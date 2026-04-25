# CA Rotation Strategy (Vault PKI)

This document outlines the strategy for rotating the Root and Intermediate Certificate Authorities using HashiCorp Vault.

## Current Architecture
The system uses a tiered CA hierarchy:
1.  **Vault Root CA**: Self-signed root (TTL: 10 years).
2.  **Vault Intermediate CA**: Signed by Root (TTL: 5 years).
3.  **Leaf Certificates**: Issued by Intermediate CA for services and agents (TTL: 90 days).

## Rotation Schedule

| Component | Rotation Frequency | Trigger |
|---|---|---|
| Leaf Certs | Every 60 days | Automatic (via service logic) |
| Intermediate CA | Every 2 years | Manual (scheduled) |
| Root CA | Every 5 years | Manual (scheduled) |

## Operational Procedures

### 1. Leaf Certificate Rotation (Services & Agents)
Services and agents are configured to request new certificates from Vault when their current certificate reaches 2/3 of its lifetime.

**Triggering manual rotation:**
```bash
# Issue new cert for an agent
vault write pki_int/issue/edge-agents common_name="agent-001.edgecloud.io"
```

### 2. Intermediate CA Rotation
1.  Enable a new PKI path: `vault secrets enable -path=pki_int_v2 pki`
2.  Generate a new CSR: `vault write pki_int_v2/intermediate/generate/internal ...`
3.  Sign with Root CA: `vault write pki/root/sign-intermediate ...`
4.  Update roles and policies to point to `pki_int_v2`.
5.  After all services have rotated to the new CA, decommission `pki_int`.

### 3. Root CA Rotation (Emergency or Scheduled)
1.  Generate a new Root CA in a new path.
2.  Issue new Intermediate CAs from the new Root.
3.  Distribute the new Root CA certificate to all nodes (trust bundle).
4.  Nodes must trust BOTH old and new Roots during the transition period.
5.  Once transition is complete, remove the old Root from the trust bundle.

## Incident Response (Compromise)
In case of a suspected CA compromise:
1.  **Immediate Revocation**: Revoke all issued certificates via `vault write pki_int/revoke serial_number=...`
2.  **CA Invalidation**: Revoke the Intermediate CA certificate in the Root CA.
3.  **Full Rotation**: Execute the Root CA Rotation procedure immediately.
4.  **Audit**: Review Vault audit logs (`/vault/logs/audit.log`) for unauthorized access.
