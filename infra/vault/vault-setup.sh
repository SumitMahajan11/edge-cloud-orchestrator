#!/bin/bash
# Vault Setup Script for Edge-Cloud Orchestrator
# Run this after Vault is initialized and unsealed

set -e

VAULT_ADDR=${VAULT_ADDR:-"https://localhost:8200"}
VAULT_TOKEN=${VAULT_TOKEN:-""}

if [ -z "$VAULT_TOKEN" ]; then
  echo "Error: VAULT_TOKEN environment variable not set"
  exit 1
fi

echo "=== Setting up Vault for Edge-Cloud Orchestrator ==="

# Enable KV secrets engine v2 for configuration secrets
vault secrets enable -version=2 -path=secret kv

# Enable database secrets engine for dynamic database credentials
vault secrets enable database

# Enable PKI secrets engine for certificate management
vault secrets enable pki
vault secrets tune -max-lease-ttl=87600h pki

# Configure PKI root CA
vault write pki/root/generate/internal \
  common_name="EdgeCloud-CA" \
  ttl=87600h

vault write pki/config/urls \
  issuing_certificates="$VAULT_ADDR/v1/pki/ca" \
  crl_distribution_points="$VAULT_ADDR/v1/pki/crl"

# Create Vault PKI role for agent certificates
vault write pki/roles/edge-agent \
  allowed_domains="edge.local" \
  allow_subdomains=true \
  max_ttl=8760h

# Configure database secrets engine for CockroachDB
vault write database/config/edgecloud-crdb \
  plugin_name=postgresql-database-plugin \
  allowed_roles="app-readonly,app-readwrite,app-admin" \
  connection_url="postgresql://{{username}}:{{password}}@cockroachdb:26257/edgecloud?sslmode=verify-full" \
  username="vaultadmin" \
  password="vaultadmin-password"

# Create database roles
vault write database/roles/app-readonly \
  db_name=edgecloud-crdb \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; \
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" \
  default_ttl=1h \
  max_ttl=24h

vault write database/roles/app-readwrite \
  db_name=edgecloud-crdb \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; \
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" \
  default_ttl=1h \
  max_ttl=24h

# Store static secrets
echo "=== Storing static secrets ==="

# Database credentials
vault kv put secret/database/crdb \
  username="edgecloud_app" \
  password="$(openssl rand -base64 32)"

# Kafka credentials
vault kv put secret/kafka/admin \
  username="admin" \
  password="$(openssl rand -base64 32)"

vault kv put secret/kafka/scheduler \
  username="scheduler" \
  password="$(openssl rand -base64 32)"

# JWT signing keys
vault kv put secret/auth/jwt \
  private_key="$(openssl genrsa 4096 2>/dev/null)" \
  public_key="$(openssl rsa -pubout 2>/dev/null)"

# API keys
vault kv put secret/api/internal \
  key="$(openssl rand -hex 32)"

# Encryption keys
vault kv put secret/encryption/data \
  key="$(openssl rand -base64 32)"

# Enable AppRole auth method for services
vault auth enable approle

# Create policies
cat > /tmp/edgecloud-service-policy.hcl << 'EOF'
path "secret/data/database/crdb" {
  capabilities = ["read"]
}

path "secret/data/kafka/scheduler" {
  capabilities = ["read"]
}

path "database/creds/app-readwrite" {
  capabilities = ["read"]
}
EOF

cat > /tmp/edge-agent-policy.hcl << 'EOF'
path "secret/data/api/internal" {
  capabilities = ["read"]
}

path "pki/issue/edge-agent" {
  capabilities = ["create", "update"]
}
EOF

vault policy write edgecloud-service /tmp/edgecloud-service-policy.hcl
vault policy write edge-agent /tmp/edge-agent-policy.hcl

# Create AppRoles
vault write auth/approle/role/scheduler-service \
  token_ttl=1h \
  token_max_ttl=4h \
  token_policies="edgecloud-service" \
  bind_secret_id=true

vault write auth/approle/role/task-service \
  token_ttl=1h \
  token_max_ttl=4h \
  token_policies="edgecloud-service" \
  bind_secret_id=true

vault write auth/approle/role/edge-agent \
  token_ttl=24h \
  token_max_ttl=168h \
  token_policies="edge-agent" \
  bind_secret_id=true

# Get RoleIDs for services
echo "=== AppRole RoleIDs ==="
echo "Scheduler Service RoleID:"
vault read -field=role_id auth/approle/role/scheduler-service/role-id

echo "Task Service RoleID:"
vault read -field=role_id auth/approle/role/task-service/role-id

echo "Edge Agent RoleID:"
vault read -field=role_id auth/approle/role/edge-agent/role-id

echo "=== Vault setup complete ==="
