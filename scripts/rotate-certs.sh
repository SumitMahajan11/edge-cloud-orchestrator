#!/bin/bash
set -e

# rotate-certs.sh
# Safely rotates certificates for Edge-Cloud Orchestrator by fetching from Vault
# and applying to the Kubernetes cluster.

echo "Fetching new certificate from HashiCorp Vault..."
# We assume VAULT_ADDR and VAULT_TOKEN are properly set in the environment
CERT_DATA=$(vault read -format=json pki/issue/edgecloud-services common_name="edgecloud.internal" ttl="730h")

CERT=$(echo "$CERT_DATA" | jq -r '.data.certificate')
KEY=$(echo "$CERT_DATA" | jq -r '.data.private_key')
CA_CHAIN=$(echo "$CERT_DATA" | jq -r '.data.ca_chain[]' | tr -d '\n')

if [ -z "$CERT" ] || [ -z "$KEY" ]; then
  echo "ERROR: Failed to retrieve certificate from Vault."
  exit 1
fi

echo "Creating/Updating Kubernetes TLS secret..."
# We use a temporary namespace for safety if required, defaulting to edgecloud-staging
NAMESPACE=${NAMESPACE:-edgecloud-staging}

# Delete existing secret if it exists to replace it cleanly
kubectl delete secret edgecloud-tls -n "$NAMESPACE" --ignore-not-found

kubectl create secret tls edgecloud-tls \
  --cert=<(echo "$CERT") \
  --key=<(echo "$KEY") \
  -n "$NAMESPACE"

echo "Triggering rolling restarts to apply new certificates..."
kubectl rollout restart deployment -n "$NAMESPACE"

echo "Certificate rotation successfully triggered."
