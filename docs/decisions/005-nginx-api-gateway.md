# ADR 005 — Use Nginx as API Gateway, not Kong

**Date:** 2026-04-25  
**Status:** Accepted  
**Category:** API Gateway

## Context

Edge-Cloud Orchestrator needs an API gateway to handle:
- **Reverse proxy** — Route requests to backend services (API, agent, scheduler)
- **Rate limiting** — Per-user rate limits to prevent abuse
- **Request validation** — Catch invalid requests early (before they reach services)
- **TLS termination** — HTTPS with modern TLS 1.3, HSTS
- **Load balancing** — Distribute traffic across service replicas
- **WebSocket support** — Proxy WebSocket connections for real-time updates

Two primary options were evaluated:

### Kong API Gateway
- Built on Nginx with Lua plugin system
- Rich plugin ecosystem (authentication, rate limiting, transformations)
- YAML/Declarative configuration
- Higher-level abstractions (API key management, consumer management)
- Requires PostgreSQL for configuration storage

### Nginx (Open Source)
- Lightweight, proven reverse proxy
- Excellent performance at scale
- Configuration via `nginx.conf` (imperative)
- Rate limiting via `limit_req` module
- Request validation via Lua scripts (inline)

## Decision

**We use Nginx as the primary API gateway.**

### Rationale

1. **Lower Resource Footprint**
   - Nginx: ~10MB memory per worker process
   - Kong: ~100MB+ (Nginx + Lua VM + plugin framework + database connections)
   - Critical for edge deployments with limited resources

2. **Excellent Performance**
   - Nginx handles 100k+ requests/sec on modest hardware
   - No plugin overhead (Lua scripts run inline, not per-request VM)
   - Proven at scale (Netflix, Airbnb, Dropbox use Nginx)

3. **Request Validation via Lua**
   - Custom validation logic in `validate_task_request.lua`
   - Catches invalid requests before they reach backend services
   - No plugin overhead (direct execution in Nginx worker)

4. **Rate Limiting via `limit_req` Module**
   - Built-in token bucket algorithm
   - Per-user rate limiting (JWT extraction)
   - Burst handling with `nodelay` option
   - No external dependencies

5. **Simpler Operational Model**
   - Single binary (no database, no plugin manager)
   - Configuration in `nginx.conf` (single file)
   - Easy to debug (standard Nginx logging, metrics)

## Consequences

### Positive
- ✅ **Minimal Dependencies** — Just Nginx (no PostgreSQL for config, no plugin DB)
- ✅ **Very Fast** — Proven at scale, minimal overhead
- ✅ **Lower Resource Usage** — 10x less memory than Kong
- ✅ **Full Control** — Custom Lua scripts for validation (no plugin limitations)
- ✅ **Simpler Debugging** — Standard Nginx error logs, no plugin stack traces

### Negative
- ⚠️ **Lua Scripting Less Ergonomic** — More verbose than Kong plugins (YAML config)
- ⚠️ **Loss of Kong's Higher-Level Abstractions** — No built-in API key management, consumer portal
- ⚠️ **Manual Configuration** — No declarative YAML (must maintain `nginx.conf`)
- ⚠️ **No Plugin Ecosystem** — Must implement features from scratch (auth, transformations)

## Implementation Details

### Rate Limiting Configuration
```nginx
# Per-user rate limiting zones
limit_req_zone $user_id zone=user_tasks:10m rate=100r/s;
limit_req_zone $user_id zone=user_general:10m rate=1000r/s;

# Apply rate limiting to endpoints
location /v1/tasks {
    limit_req zone=user_tasks burst=10 nodelay;
    proxy_pass http://task-service:3001;
}

location /v1/ {
    limit_req zone=user_general burst=50 nodelay;
    proxy_pass http://api:3000;
}
```

### Request Validation (Lua)
```lua
-- /etc/nginx/lua/validate_task_request.lua
local json = require "cjson"
local body = ngx.var.request_body

if ngx.var.request_method == "POST" then
    local ok, data = pcall(json.decode, body)
    if not ok or not data.image or not data.command then
        return ngx.exit(400)
    end
end
```

### JWT Extraction for Per-User Rate Limiting
```nginx
map $http_authorization $user_id {
    default "anonymous";
    "~^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$" $1;
}
```

### Custom 429 Response
```nginx
error_page 429 @rate_limit_exceeded;
location @rate_limit_exceeded {
    default_type text/plain;
    return 429 'Too many requests. Limit exceeded per user rate limit.';
    add_header Retry-After 60 always;
}
```

## Mitigation Strategies

1. **API Key Management Complexity**
   - If API key management becomes complex, add a **sidecar service** (not Kong)
   - Sidecar handles: key generation, rotation, revocation, rate limit tiers
   - Nginx validates keys via sidecar HTTP call (auth_request module)

2. **Configuration Management**
   - Use CI/CD pipeline to generate `nginx.conf` from templates
   - Store configuration in Git (version-controlled, auditable)
   - Validate config syntax before deployment (`nginx -t`)

3. **Lua Script Maintenance**
   - Keep Lua scripts minimal (validation, simple transformations)
   - Use external libraries (lua-cjson, lua-resty-*) for common operations
   - Test Lua scripts with unit tests (busted framework)

4. **Monitoring**
   - Export Nginx metrics to Prometheus (nginx-exporter)
   - Track: request rate, error rate, latency, rate limit hits
   - Alert on 5xx errors, rate limit exhaustion

## Feature Comparison

| Feature | Nginx | Kong |
|---------|-------|------|
| Reverse Proxy | ✅ | ✅ |
| Rate Limiting | ✅ (built-in) | ✅ (plugin) |
| Request Validation | ✅ (Lua) | ✅ (plugin) |
| TLS Termination | ✅ | ✅ |
| Load Balancing | ✅ | ✅ |
| WebSocket Support | ✅ | ✅ |
| API Key Management | ❌ (custom) | ✅ (plugin) |
| Consumer Portal | ❌ | ✅ |
| Plugin Ecosystem | ❌ | ✅ (100+ plugins) |
| Resource Usage | ~10MB | ~100MB+ |
| Configuration | nginx.conf | YAML/DB |
| Learning Curve | Low | Medium |

## Future Considerations

If requirements evolve:

1. **API Key Management Becomes Complex**
   - Add auth sidecar service (not Kong)
   - Sidecar handles key lifecycle, Nginx validates via HTTP call

2. **Need for Advanced Plugins**
   - Evaluate Kong for specific use cases (not full migration)
   - Run Kong as separate service for specific APIs

3. **Service Mesh Requirements**
   - Consider Istio/Linkerd for service-to-service mTLS, traffic splitting
   - Nginx remains edge gateway, service mesh handles internal traffic

## Revisit Triggers

This decision should be revisited when:
- API key management requires complex features (OAuth2, OIDC, consumer tiers)
- Need for 10+ different request/response transformations
- Team size grows and Kong's declarative config becomes valuable
- Plugin ecosystem saves significant development time (> 2 engineer-months)

## Alternatives Considered

- **Envoy** — More modern, but steeper learning curve, complex configuration
- **Traefik** — Simpler, but less mature, smaller ecosystem
- **HAProxy** — Excellent performance, but no Lua scripting (harder to extend)
- **AWS API Gateway** — Vendor lock-in, not suitable for hybrid cloud

## References

- Nginx Documentation: https://nginx.org/en/docs/
- Nginx Rate Limiting: https://docs.nginx.com/nginx/admin-guide/security-controls/controlling-access-proxied-http/
- Kong vs Nginx: https://docs.konghq.com/gateway/latest/plan-and-deploy/kong-vs-nginx/
- Lua Nginx Module: https://github.com/openresty/lua-nginx-module
