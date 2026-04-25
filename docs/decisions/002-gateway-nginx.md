# ADR-002: Gateway Strategy Consolidation (Nginx)

**Status**: Accepted  
**Date**: 2026-04-19  
**Authors**: Engineering Team  

---

## Context

The Edge-Cloud Orchestrator previously maintained two parallel API Gateway implementations:
1. **Kong API Gateway**: A feature-rich gateway built on Nginx, configured via declarative `kong.yml`.
2. **Nginx (Custom)**: A lightweight, high-performance web server and proxy used in the `api-gateway` service.

Maintaining Kong introduced significant operational overhead, including a dependency on a database (or complex declarative config sync) and increased resource consumption. Our custom Nginx configuration already handled the majority of proxying and load balancing requirements.

## Decision

We have decided to **standardize on Nginx** as the sole API Gateway and **decommission Kong**.

### Rationale

1. **Lightweight Footprint**: Nginx consumes significantly less memory and CPU compared to Kong's Lua-based plugin architecture.
2. **Infrastructure Simplicity**: By using standard Nginx, we reduce the number of moving parts in our deployment pipeline.
3. **Configuration as Code**: Nginx configurations are easily managed within our monorepo and integrated into our Docker/K8s workflows without requiring secondary control planes.
4. **Feature Parity**: Rate limiting, JWT validation (via Lua or auth_request), and load balancing can all be implemented natively or with minimal modules in Nginx.

### Migrated Configurations

Rate limiting configurations have been ported from Kong's `rate-limiting` plugin to Nginx `limit_req_zone` and `limit_req` directives:

| Endpoint | Kong Limit | Nginx Zone |
|---|---|---|
| `/api/auth` | 100/min | `zone=auth rate=100r/m` |
| `/api/tasks` | 500/min | `zone=tasks rate=500r/m` |
| `/api/nodes` | 500/min | `zone=nodes rate=500r/m` |
| `/api/scheduler` | 100/min | `zone=scheduler rate=100r/m` |
| `/ws` | 1000/min | `zone=ws rate=1000r/m` |
| `/health` | 1000/min | `zone=health rate=1000r/m` |

## Consequences

- **Kong Decommissioned**: `infra/kong/` directory has been removed.
- **Service Dependency**: `docker-compose.yml` no longer includes the Kong service.
- **Uniformity**: All traffic management logic is now consolidated in `apps/api-gateway/nginx.conf`.
