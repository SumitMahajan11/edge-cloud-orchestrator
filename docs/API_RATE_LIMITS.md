# API Rate Limits

Rate limiting is enforced at the API Gateway (Nginx) layer to prevent abuse and protect backend services.

## Rate Limit Configuration

All rate limits are **per-user**, extracted from JWT tokens. Requests without valid JWT tokens use the "anonymous" bucket.

| Endpoint | Method | Limit | Burst | Window | Notes |
|----------|--------|-------|-------|--------|-------|
| `/tasks` | POST | 100 req/s | 10 | 1 second | Task creation with validation |
| `/tasks` | GET | 100 req/s | 10 | 1 second | Task listing |
| `/tasks/{id}` | DELETE | 50 req/s | 5 | 1 second | Task deletion (stricter) |
| `/tasks/{id}` | GET/PUT | 100 req/s | 10 | 1 second | Task retrieval/update |
| `/api/*` | ALL | 1000 req/s | 50 | 1 second | General API operations |
| `/api/auth/*` | POST | 5 req/m | 3 | 1 minute | Authentication (IP-based) |
| `/nodes` | ALL | 1000 req/s | 50 | 1 second | Node management |
| `/schedule` | ALL | 1000 req/s | 50 | 1 second | Scheduler operations |
| `/ws` | WebSocket | N/A | N/A | N/A | No rate limit (persistent connections) |
| `/health` | GET | Unlimited | N/A | N/A | Health checks excluded |

## Rate Limit Headers

When a request is rate-limited, the following headers are included in the 429 response:

```
HTTP/1.1 429 Too Many Requests
Content-Type: text/plain
Retry-After: 60
X-RateLimit-Limit: 100
X-RateLimit-Reset: 60

Too many requests. Limit exceeded per user rate limit.
```

## Request Validation

Task creation requests (`POST /tasks`) are validated at the gateway layer before reaching backend services:

### Required Fields
- `image` (string, non-empty): Container image name
- `command` (string, non-empty): Command to execute

### Validation Errors
Invalid requests receive a `400 Bad Request` response with detailed error messages:

```json
{
  "error": "Missing or invalid required field: image",
  "status": 400
}
```

### Validation Rules
1. Request body must be valid JSON
2. `image` field must be a non-empty string
3. `command` field must be a non-empty string
4. For PUT requests, at least one field must be present

## User Identification

Rate limits are applied per-user based on JWT tokens:

1. **Authenticated users**: Rate limit bucket is the JWT token extracted from `Authorization: Bearer <token>` header
2. **Unauthenticated requests**: All anonymous requests share the "anonymous" bucket
3. **Real IP detection**: Behind proxies, real client IP is extracted from `X-Forwarded-For` header

## Monitoring

Rate limiting metrics are exported to Prometheus:

- `nginx_limiting_requests_total`: Total number of rate-limited requests
- `nginx_http_requests_total`: Total HTTP requests by status code
- `nginx_connections_active`: Active connections

### Grafana Dashboard

Monitor rate limiting effectiveness:
- Requests hitting rate limits over time
- Rate-limited requests by endpoint
- Anonymous vs authenticated request distribution

## Tuning

To adjust rate limits, modify the `limit_req_zone` directives in `nginx.conf`:

```nginx
# Format: limit_req_zone $user_id zone=<name>:<size> rate=<rate>;
limit_req_zone $user_id zone=user_tasks:10m rate=100r/s;
```

- **zone size**: 10m can store ~160,000 unique user states
- **rate**: Requests per second/minute allowed
- **burst**: Additional requests allowed in short spikes (configured in `location` blocks)

## Production Considerations

1. **JWT decoding**: Current implementation uses raw token as user_id. For production, decode JWT to extract `sub` claim for consistent user identification
2. **Redis backend**: For distributed deployments, use Redis-based rate limiting (`lua_shared_dict` or external Redis)
3. **Adaptive limits**: Consider dynamic rate limits based on user tier (free/premium/enterprise)
4. **DDoS protection**: Combine with WAF rules and IP-based blacklisting for comprehensive protection
