# ADR 002: Standardization on Nginx API Gateway

## Status
Accepted

## Context
The Edge-Cloud Orchestrator previously maintained two API gateway implementations:
1. `apps/api-gateway/`: An Nginx-based implementation, already containerized and integrated into the local development environment.
2. `infra/kong/`: A Kong-based declarative configuration.

Maintaining two gateways introduced ambiguity in routing logic, redundant configuration overhead, and increased the complexity of the security posture. Kong provides advanced plugin capabilities (JWT validation, ACLs, etc.), but these are currently handled more efficiently within the application middleware (Fastify/Node.js) or are not yet required at the current scale.

## Decision
We will standardize on **Nginx** as the primary API Gateway for the Edge-Cloud Orchestrator and decommission the Kong infrastructure.

Nginx was chosen because:
- It is lightweight and highly performant for the current routing requirements.
- It is already integrated into the `docker-compose.yml` and startup scripts.
- It provides sufficient features for rate limiting, TLS termination, and request transformation via standard modules.
- It reduces the infrastructure footprint and simplifies the developer onboarding experience.

## Consequences
- The `infra/kong/` directory will be removed.
- All routing, rate limiting, and security headers must be configured in `apps/api-gateway/nginx.conf`.
- Advanced Kong features (like automated JWT validation) will be deferred to application-level middleware to keep the gateway layer simple and transparent.
- Production-grade configurations (Rate limiting, Gzip, Security headers) will be implemented in the Nginx configuration.

## Feature Coverage Matrix

| Feature | Kong Implementation | Nginx Implementation | Status |
| :--- | :--- | :--- | :--- |
| **Routing** | Declarative in `kong.yml` | Location blocks in `nginx.conf` | Migrated |
| **Rate Limiting** | `rate-limiting` plugin | `limit_req_zone` directive | Enhanced (100r/s) |
| **Request ID** | `correlation-id` plugin | `add_header X-Request-ID` | Implemented |
| **JWT Validation** | `jwt` plugin | Application Middleware | Handled in App |
| **CORS** | `cors` plugin | Application Middleware | Handled in App |
| **Health Checks** | `/health` route | Native location block | Implemented |
| **Gzip** | Default (Implicit) | `gzip on` directive | Implemented |
| **Security Headers** | Implicit | Explicit `add_header` | Implemented |
