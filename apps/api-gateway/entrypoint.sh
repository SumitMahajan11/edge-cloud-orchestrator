#!/bin/sh
set -e

echo "🚀 Starting mTLS Gateway Initialization..."

# Ensure the certs directory exists
mkdir -p /etc/nginx/ssl

# 1. Fetch the CA Certificate from the internal API
API_INTERNAL_URL=${API_URL:-"http://api:3090"}
echo "📝 Fetching CA certificate from $API_INTERNAL_URL/v2/agents/ca..."

# Attempt to fetch CA cert with retries in case the API is starting up
max_retries=10
retry_count=0
until curl -s -f "$API_INTERNAL_URL/v2/agents/ca" -o /tmp/ca_response.json || [ $retry_count -eq $max_retries ]; do
    echo "Waiting for API to be ready (attempt $((retry_count+1))/$max_retries)..."
    sleep 3
    retry_count=$((retry_count+1))
done

if [ -f /tmp/ca_response.json ]; then
    # Parse certificate PEM using jq
    jq -r '.certificate' /tmp/ca_response.json > /etc/nginx/ssl/ca.crt
    echo "✅ CA certificate written to /etc/nginx/ssl/ca.crt"
else
    echo "❌ Failed to fetch CA certificate from API. Exiting."
    exit 1
fi

# 2. Decode and write server certificate and key if provided in env vars
if [ -n "$SSL_SERVER_CERT" ] && [ -n "$SSL_SERVER_KEY" ]; then
    echo "📝 Decoding server certificate and private key from environment variables..."
    echo "$SSL_SERVER_CERT" | base64 -d > /etc/nginx/ssl/server.crt
    echo "$SSL_SERVER_KEY" | base64 -d > /etc/nginx/ssl/server.key
    echo "✅ Server certificate and key written to /etc/nginx/ssl/"
else
    echo "⚠️ SSL_SERVER_CERT or SSL_SERVER_KEY not set. Generating temporary self-signed certificate for fallback..."
    # Generate temporary self-signed fallback server cert
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/nginx/ssl/server.key \
        -out /etc/nginx/ssl/server.crt \
        -subj "/C=US/ST=California/L=San Francisco/O=EdgeCloud/OU=Server/CN=localhost"
    echo "✅ Temporary fallback certificate generated."
fi

# Set permissions
chmod 600 /etc/nginx/ssl/server.key
chmod 644 /etc/nginx/ssl/server.crt /etc/nginx/ssl/ca.crt

echo "🏁 Initialization complete. Starting Nginx..."
exec nginx -g "daemon off;"
