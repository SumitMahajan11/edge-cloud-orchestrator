# HashiCorp Vault Infrastructure

This directory contains the configuration and setup scripts for HashiCorp Vault, which manages all cryptographic material for the Edge-Cloud Orchestrator.

## Files

- `vault-config.hcl`: Main Vault configuration (Raft storage, TCP listener).
- `vault-setup.sh`: Post-initialization script to enable PKI, database secrets, and AppRole auth.

## PKI Infrastructure

Vault acts as the Internal Certificate Authority. It provides:

- **Root CA**: Stored securely in the `pki/` path.
- **Intermediate CA**: Stored in `pki_int/`.
- **Dynamic Issuance**: Services and agents use AppRole to authenticate and request short-lived certificates.

## Setup Instructions

1.  Start Vault: `vault server -config=vault-config.hcl`
2.  Initialize and Unseal (manual step).
3.  Set `VAULT_TOKEN` and run `./vault-setup.sh`.

## Security Best Practices

- **No Private Keys in Git**: Never commit `.key` or `.pfx` files. All keys are generated and stored inside Vault.
- **AppRole**: Use least-privilege policies for each service.
- **Audit Logging**: Audit logs are enabled and should be forwarded to a secure log aggregator.

For certificate rotation procedures, see [docs/CA_ROTATION_STRATEGY.md](../../docs/CA_ROTATION_STRATEGY.md).
