# Deploying the Nginx mTLS Gateway on Railway: Planning & Architecture

This document defines a concrete, actionable plan for deploying `apps/api-gateway` as an mTLS-terminating reverse proxy in front of the API on Railway.

---

## 1. Certificate Provisioning Strategy

Nginx requires three files on the filesystem to negotiate TLS and perform mTLS verification:
1. **CA Root Certificate (`ca.crt`)**: Used to verify client certificates presented by the agents.
2. **Server Certificate (`server.crt`)**: Presented to the agents to verify the server's identity.
3. **Server Private Key (`server.key`)**: Used in the TLS handshake.

### CA Certificate Lifecycle Mapping
The Root CA certificate is dynamically managed by the API's `CertificateAuthorityManager` and stored in the database (`certificate_authorities` table). Instead of copying this certificate manually or hardcoding it, Nginx will fetch it dynamically at boot time.
- The Nginx gateway will communicate internally with the API service.
- The API exposes a public, unauthenticated endpoint at `/v2/agents/ca` which returns `{ certificate: caManager.getCACertificate() }`.
- During container startup, a custom entrypoint script will query this endpoint and write the certificate to the expected Nginx path:
  ```bash
  curl -s http://api:3090/v2/agents/ca | jq -r .certificate > /etc/nginx/ssl/ca.crt
  ```
- This ensures that CA rotations or database updates are picked up automatically by restarting the Nginx gateway, with zero manual configuration.

### Server Certificate & Key Provisioning
Since Railway's automatic SSL termination cannot be used for mTLS (as it terminates at the edge and strips client certificates), Nginx must handle the TLS handshake directly.
- **Recommended Strategy**: Store a valid domain certificate (e.g., wildcard certificate) and private key in Railway's Shared Variables or Vault as base64-encoded strings (`SSL_SERVER_CERT` and `SSL_SERVER_KEY`).
- At container startup, the entrypoint script decodes these values and writes them to the expected Nginx paths:
  ```bash
  echo "$SSL_SERVER_CERT" | base64 -d > /etc/nginx/ssl/server.crt
  echo "$SSL_SERVER_KEY" | base64 -d > /etc/nginx/ssl/server.key
  ```

---

## 2. Railway-Specific Configurations

### Raw TCP Proxying for mTLS
By default, Railway exposes web services using standard HTTP/HTTPS endpoints. These terminate TLS at the Railway Edge/Load Balancer. This is incompatible with mTLS because:
- The Railway Edge does not prompt the client for a certificate.
- The TLS handshake is completed at the edge, and the client certificate is discarded before the request is forwarded.

**Solution**:
1. Configure a **TCP Proxy** in the Railway dashboard for the `api-gateway` service.
2. Railway will expose a public port mapping (e.g., `services.railway.app:12345` or `api-mtls.yourdomain.com:12345`) which routes raw TCP packets directly to the gateway container's exposed port (`443`).
3. This allows the TLS session to be terminated by Nginx, enabling raw certificate exchange and handshake-level validation.

### Private Service Networking
Once Nginx validates the client certificate, it must proxy the request to the upstream API.
- Railway provides private network DNS names for services within the same project (e.g., `http://api.railway.internal:3090` or `http://api:3090`).
- Update `apps/api-gateway/nginx.conf` upstreams to route traffic to these internal hostnames:
  ```nginx
  upstream backend {
      server api:3090; # Internal Railway DNS for the API service
  }
  ```

### API Trust Proxy and Hardening
When Nginx forwards the request, it passes the client certificate in the `X-Client-Cert` header. The API must be configured to process this header securely:
- **`TRUST_X_CLIENT_CERT`**: Set to `true` on the API service to enable parsing of the `X-Client-Cert` header.
- **`TRUST_PROXY`**: Configure this variable on the API service to restrict accepted `X-Client-Cert` headers to Nginx's IP addresses.
  - In Railway, private container IPs reside in the standard RFC1918 subnets (e.g., `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) or IPv6 private range (`fc00::/7`).
  - Set `TRUST_PROXY=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7` to ensure that only internal proxies can forward client certificates, preventing external spoofing.

---

## 3. Risk Mitigation and Rollback Procedures

### Risks & Mitigations
*   **Risk**: Client certificate parsing fails in production due to URL encoding differences between Nginx and Fastify.
    *   *Mitigation*: The Nginx config uses `proxy_set_header X-Client-Cert $ssl_client_escaped_cert;`. Fastify handles decoding with `decodeURIComponent(escapedCert)`. We will verify this flow locally using Docker Compose before pushing to production.
*   **Risk**: The API is exposed publicly, allowing attackers to directly hit port `3090` and spoof headers if `TRUST_PROXY` is too broad.
    *   *Mitigation*: Ensure the API service does not have a public domain/port assigned in Railway. It must *only* be accessible via the private network and the `api-gateway` proxy.
*   **Risk**: High latency or connection drops over TCP proxying.
    *   *Mitigation*: Configure TCP keepalives and appropriate buffer size limits in `nginx.conf` for raw TCP streams.

### Rollback Plan
If the gateway deployment introduces connection failures or regressions:
1. **Disable Proxy Header Parsing**: Set `TRUST_X_CLIENT_CERT=false` on the API. The API will revert to rejecting proxy certificates.
2. **Redirect Agent Traffic**: Update the agents' `ORCHESTRATOR_URL` back to the direct HTTPS endpoint (which can temporarily run with alternative authentication, e.g., API keys, if emergency bypass is needed).
3. **Scale Gateway Down**: Scale the `api-gateway` service to `0` replicas in Railway.

---

## 4. Ordered Deployment Plan

### Step 1: Repository Configuration Changes (Codebase)
1. **Create the Entrypoint Script (`apps/api-gateway/entrypoint.sh`)**:
   - Fetches `ca.crt` from the API service.
   - Decodes `SSL_SERVER_CERT` and `SSL_SERVER_KEY` from environment variables.
   - Starts Nginx in the foreground.
2. **Update the Dockerfile (`apps/api-gateway/Dockerfile`)**:
   - Install `curl`, `jq`, and `openssl`.
   - Copy `entrypoint.sh` and set it as the container entrypoint.
3. **Update Nginx Configuration (`apps/api-gateway/nginx.conf`)**:
   - Point upstream `backend` to `api:3090` (internal Railway DNS).
   - Ensure rate limiting zones are set up correctly.

### Step 2: Railway Dashboard Manual Setup (Infrastructure)
1. **Set Gateway Environment Variables**:
   - Add `SSL_SERVER_CERT` (base64-encoded server certificate).
   - Add `SSL_SERVER_KEY` (base64-encoded server private key).
2. **Configure Port Exposures**:
   - Expose port `80` (HTTP) with a standard public web domain for general dashboard static files.
   - Expose port `443` (HTTPS) as a **TCP Proxy** in Railway. Copy the assigned TCP endpoint (e.g., `services.railway.app:12345`).
3. **Harden the API Service**:
   - Remove any public domains from the `api` service.
   - Set `TRUST_X_CLIENT_CERT=true`.
   - Set `TRUST_PROXY=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7`.

### Step 3: Verification
1. Verify the `api-gateway` health check passes at `http://localhost/health`.
2. Connect a test client using a generated certificate directly to the Railway TCP Proxy endpoint.
3. Assert that Nginx validates the certificate, proxies the request, and the API correctly parses the node identity.
