# HashiCorp Vault Configuration
# Production-ready Vault setup for secrets management

storage "raft" {
  path = "/vault/data"
  node_id = "vault-1"
}

listener "tcp" {
  address = "0.0.0.0:8200"
  tls_cert_file = "/vault/certs/vault.crt"
  tls_key_file = "/vault/certs/vault.key"
  tls_min_version = "tls13"
}

api_addr = "https://vault-1:8200"
cluster_addr = "https://vault-1:8201"

ui = true

# Enable audit logging
audit "file" {
  path = "/vault/logs/audit.log"
}

# Performance tuning
default_lease_ttl = "768h"  # 32 days
max_lease_ttl = "8760h"     # 365 days

# Telemetry for monitoring
telemetry {
  prometheus_retention_time = "30s"
  disable_hostname = true
}

# Seal configuration (use auto-unseal in production with cloud KMS)
# seal "awskms" {
#   region = "us-east-1"
#   kms_key_id = "arn:aws:kms:us-east-1:..."
# }

# Plugin directory
plugin_directory = "/vault/plugins"
