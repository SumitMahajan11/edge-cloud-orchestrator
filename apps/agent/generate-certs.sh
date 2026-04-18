#!/bin/bash
# Script to generate mTLS certificates for Edge Agent

set -e

CERT_DIR="./certs"
DAYS=365

echo "🔐 Generating mTLS certificates for Edge Agent..."

# Create certs directory
mkdir -p $CERT_DIR

# 1. Generate CA private key and certificate
echo "📝 Generating CA certificate..."
openssl genrsa -out $CERT_DIR/ca.key 4096
openssl req -new -x509 -days $DAYS -key $CERT_DIR/ca.key -out $CERT_DIR/ca.crt \
  -subj "/C=US/ST=California/L=San Francisco/O=EdgeCloud/OU=CA/CN=EdgeCloud-CA"

# 2. Generate server certificate
echo "📝 Generating server certificate..."
openssl genrsa -out $CERT_DIR/server.key 4096
openssl req -new -key $CERT_DIR/server.key -out $CERT_DIR/server.csr \
  -subj "/C=US/ST=California/L=San Francisco/O=EdgeCloud/OU=Server/CN=localhost"

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
  -subj "/C=US/ST=California/L=San Francisco/O=EdgeCloud/OU=Client/CN=orchestrator"

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
echo "✅ Certificates generated successfully!"
echo ""
echo "📁 Certificate files:"
echo "   CA:         $CERT_DIR/ca.crt"
echo "   Server Key: $CERT_DIR/server.key"
echo "   Server Cert: $CERT_DIR/server.crt"
echo "   Client Key: $CERT_DIR/client.key"
echo "   Client Cert: $CERT_DIR/client.crt"
echo ""
echo "🚀 To enable mTLS, set these environment variables:"
echo "   ENABLE_MTLS=true"
echo "   TLS_CERT_PATH=$CERT_DIR/server.crt"
echo "   TLS_KEY_PATH=$CERT_DIR/server.key"
echo "   TLS_CA_PATH=$CERT_DIR/ca.crt"
echo ""
echo "📋 For the orchestrator to connect, use:"
echo "   NODE_CERT_PATH=$CERT_DIR/client.crt"
echo "   NODE_KEY_PATH=$CERT_DIR/client.key"
echo "   CA_CERT_PATH=$CERT_DIR/ca.crt"
