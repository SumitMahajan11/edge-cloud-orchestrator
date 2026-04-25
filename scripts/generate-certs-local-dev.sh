#!/bin/bash
# ⚠️ WARNING: THIS SCRIPT IS FOR LOCAL DEVELOPMENT ONLY.
# ⚠️ NEVER USE THESE CERTIFICATES IN A PRODUCTION ENVIRONMENT.
# ⚠️ PRODUCTION CERTIFICATES SHOULD BE MANAGED BY A PROPER PKI (e.g., Vault, cert-manager).

set -e

CERT_DIR="./certs"
DAYS=365

echo "🔐 Generating mTLS certificates for LOCAL DEVELOPMENT..."

# Ensure we are in a safe directory
mkdir -p $CERT_DIR

# 1. Generate CA private key and certificate
echo "📝 Generating CA certificate..."
openssl genrsa -out $CERT_DIR/ca.key 4096
openssl req -new -x509 -days $DAYS -key $CERT_DIR/ca.key -out $CERT_DIR/ca.crt \
  -subj "/C=US/ST=Dev/L=Local/O=EdgeCloud-Dev/OU=CA/CN=EdgeCloud-Dev-CA"

# 2. Generate server certificate
echo "📝 Generating server certificate..."
openssl genrsa -out $CERT_DIR/server.key 4096
openssl req -new -key $CERT_DIR/server.key -out $CERT_DIR/server.csr \
  -subj "/C=US/ST=Dev/L=Local/O=EdgeCloud-Dev/OU=Server/CN=localhost"

# Create extensions file for server
cat > $CERT_DIR/server.ext << EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = *.localhost
IP.1 = 127.0.0.1
EOF

openssl x509 -req -days $DAYS -in $CERT_DIR/server.csr -CA $CERT_DIR/ca.crt -CAkey $CERT_DIR/ca.key \
  -CAcreateserial -out $CERT_DIR/server.crt -extfile $CERT_DIR/server.ext

# 3. Generate client certificate (for orchestrator)
echo "📝 Generating client certificate..."
openssl genrsa -out $CERT_DIR/client.key 4096
openssl req -new -key $CERT_DIR/client.key -out $CERT_DIR/client.csr \
  -subj "/C=US/ST=Dev/L=Local/O=EdgeCloud-Dev/OU=Client/CN=orchestrator"

# Create extensions file for client
cat > $CERT_DIR/client.ext << EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
EOF

openssl x509 -req -days $DAYS -in $CERT_DIR/client.csr -CA $CERT_DIR/ca.crt -CAkey $CERT_DIR/ca.key \
  -CAcreateserial -out $CERT_DIR/client.crt -extfile $CERT_DIR/client.ext

# 4. Clean up temporary files
rm -f $CERT_DIR/*.csr $CERT_DIR/*.ext $CERT_DIR/*.srl

# 5. Set permissions
chmod 600 $CERT_DIR/*.key
chmod 644 $CERT_DIR/*.crt

echo ""
echo "✅ Local Development Certificates generated successfully!"
echo "📁 Certificate files: $CERT_DIR"
echo "⚠️  Do not commit these to source control."
