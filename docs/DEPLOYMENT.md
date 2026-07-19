# Deployment Guide

> **Note:** The legacy Kubernetes/ArgoCD deployment infrastructure has been decommissioned. The Edge Cloud Orchestrator is deployed via **Railway**.
> For full details, see the [Deployment Reconciliation Report](../DEPLOYMENT_RECONCILIATION.md).

## Production Environment
*   **Host**: `edge-cloud-orchestrator-production.up.railway.app`
*   **Method**: Railway GitHub Integration (automatic builds on commits to the `main` branch).

## Configured Services on Railway
1.  **Fastify API Monolith** (Port `3090`)
    *   Exposed as the central control plane backend.
    *   Connects to managed PostgreSQL and Redis instances.
2.  **API Gateway (OpenResty)** (Port `443` over TCP Proxy)
    *   Terminates TLS and executes mutual TLS (mTLS) verification for edge node agent authorization.
    *   Proxies validated requests to the API monolith.

## Environment Variables Configuration

The following variables are configured directly in the Railway dashboard:

### Database & Cache
*   `DATABASE_URL`: PostgreSQL connection string.
*   `REDIS_URL`: Redis connection string.

### Authentication & Secrets
*   `JWT_SECRET`: Secret key for signing web/client access tokens.

### mTLS & Proxy Settings
*   `TRUST_X_CLIENT_CERT`: Set to `true` on the API service to parse client certificates from the gateway.
*   `TRUST_PROXY`: Restricts certificate processing to internal gateway IPs (e.g. `10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7`).
*   `SSL_SERVER_CERT`: Base64-encoded wildcard/domain server certificate for mTLS negotiation.
*   `SSL_SERVER_KEY`: Base64-encoded server private key for mTLS negotiation.

---

## Verifying Deployment
To verify the state of the active deployment, curl the health endpoint of the API monolith:
```bash
curl https://edge-cloud-orchestrator-production.up.railway.app/health
```
