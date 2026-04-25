# 🚀 Infrastructure Quick Reference

**Date:** March 29, 2026  
**Status:** ✅ PRODUCTION READY  
**Purpose:** Fast lookup for infrastructure configurations

---

## 📦 DOCKER CONFIGURATIONS

### Non-Root User Setup

```dockerfile
# All Dockerfiles use this pattern
RUN addgroup -g 1001 -S edgecloud && \
    adduser -S edgecloud -u 1001 -G edgecloud

# ... copy files ...

RUN chown -R edgecloud:edgecloud /app
USER edgecloud
```

**Services Covered:**
- ✅ Backend (port 3000)
- ✅ Task Service (port 3001)
- ✅ Node Service (port 3002)
- ✅ Scheduler Service (port 3003)
- ✅ WebSocket Gateway (port 3004)
- ✅ Edge Agent (port 8080)

### Health Check Configuration

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || PORT) + '/health', 
       (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"
```

### .dockerignore Standard Pattern

```
node_modules
npm-debug.log
.git
.gitignore
*.md
.env
.env.*
secrets/
certs/
dist/
coverage/
*.log
.DS_Store
```

---

## 🔒 SECURITY CONFIGURATIONS

### HTTPS/Nginx Setup

```nginx
# Production (HTTPS only)
server {
    listen 443 ssl http2;
    server_name api.edgecloud.io;
    
    ssl_certificate /etc/nginx/ssl/server.crt;
    ssl_certificate_key /etc/nginx/ssl/server.key;
    
    ssl_protocols TLSv1.3;
    ssl_ciphers 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256';
    
    add_header Strict-Transport-Security 'max-age=31536000; includeSubDomains' always;
}

# HTTP redirect
server {
    listen 80;
    return 301 https://$server_name$request_uri;
}
```

### Rate Limiting

**Nginx Layer:**
```nginx
limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=general:10m rate=100r/m;

location /api/auth/ {
    limit_req zone=auth burst=3 nodelay;
}

location /api/ {
    limit_req zone=general burst=20 nodelay;
}
```

**Backend Layer:**
```typescript
await app.register(rateLimit, {
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  cache: 10000,
  allowList: ['127.0.0.1'],
  redis: redis,
})
```

### RBAC Middleware Pattern

```typescript
// backend/src/middleware/authorize.ts
export function authorize(allowedRoles: string[]) {
  return async (request, reply) => {
    const user = request.user;
    
    if (!user?.role) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    
    if (!allowedRoles.includes(user.role)) {
      return reply.code(403).send({ 
        error: 'Forbidden',
        required: allowedRoles,
        actual: user.role
      });
    }
  };
}

// Usage:
fastify.get('/admin/users', {
  preHandler: authorize(['ADMIN']),
}, handler);
```

---

## 📊 MONITORING CONFIGURATION

### Prometheus Metrics

**Standard Metrics:**
```typescript
// API Latency
const apiLatency = new Histogram({
  name: 'api_request_duration_seconds',
  help: 'API request duration',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

// Task Execution
const taskDuration = new Histogram({
  name: 'task_execution_duration_seconds',
  help: 'Task execution duration',
  labelNames: ['taskType', 'status'],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
});

// Queue Length
const queueLength = new Gauge({
  name: 'task_queue_length',
  help: 'Current task queue length',
});
```

### Alert Rules

```yaml
# Critical Alerts
groups:
  - name: infrastructure
    rules:
      - alert: ServiceDown
        expr: up == 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "{{ $labels.job }} is down"
      
      - alert: HighCPU
        expr: rate(process_cpu_seconds_total[5m]) > 0.8
        for: 10m
        labels:
          severity: warning
      
      - alert: HighMemory
        expr: container_memory_usage_bytes / container_spec_memory_limit_bytes > 0.9
        for: 10m
        labels:
          severity: warning
      
      - alert: HighErrorRate
        expr: sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
```

### AlertManager Routing

```yaml
route:
  group_by: ['alertname', 'severity', 'service']
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty-critical'
    - match:
        severity: warning
      receiver: 'slack-warnings'

receivers:
  - name: 'default'
    email_configs:
      - to: 'oncall@edgecloud.io'
  
  - name: 'pagerduty-critical'
    pagerduty_configs:
      - service_key: '${PAGERDUTY_SERVICE_KEY}'
  
  - name: 'slack-warnings'
    slack_configs:
      - channel: '#edgecloud-alerts'
```

---

## 🔧 TYPESCRIPT STRICT MODE

### tsconfig.json Settings

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true
  }
}
```

---

## 🔄 CI/CD PIPELINE

### GitHub Actions Workflow

```yaml
# .github/workflows/ci-cd.yml
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint:           # Lint & Type Check (5 min)
  test:           # Unit Tests (10 min)
  security-scan:  # Security Scan (8 min)
  test-integration: # Integration Tests (15 min)
  build:          # Build (7 min)
  build-and-push: # Docker Images (20 min)
  deploy-staging: # Auto on develop
  load-test:      # Staging only
  deploy-production: # Auto on main (with approval)
```

### Deployment Gates

**Staging (develop branch):**
- ✅ Automatic deployment
- ✅ No manual approval
- ✅ Load tests run after deploy

**Production (main branch):**
- ✅ Manual approval required
- ✅ Health checks before traffic
- ✅ Rollback on failure

---

## 🌐 ENVIRONMENT VARIABLES

### Required Variables

```bash
# Backend
JWT_SECRET=<min-32-chars>
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
PORT=3000

# Services
PORT=300X  # Service-specific
NODE_ENV=production

# Monitoring
PROMETHEUS_URL=http://prometheus:9090
GRAFANA_URL=http://grafana:3000

# Alerts
SMTP_USERNAME=...
SMTP_PASSWORD=...
SLACK_WEBHOOK_URL=...
PAGERDUTY_SERVICE_KEY=...
```

### Environment-Specific Configs

**Development (.env):**
```bash
LOG_LEVEL=debug
RATE_LIMIT_MAX=1000
CORS_ORIGINS=http://localhost:5173
```

**Production (K8s Secrets):**
```bash
LOG_LEVEL=info
RATE_LIMIT_MAX=100
CORS_ORIGINS=https://app.edgecloud.io
```

---

## 📈 PERFORMANCE BENCHMARKS

### Expected Metrics

**Response Times (p95):**
- Health check: <10ms
- API GET: <100ms
- API POST: <200ms
- Database query: <50ms
- Redis operation: <10ms

**Throughput:**
- Requests/sec: 1000+
- WebSocket messages: 5000+/sec
- Task executions: 100+/sec

**Resource Usage:**
- Memory per service: 100-300MB
- CPU per service: 0.2-0.5 cores
- Network: <1Gbps per service

---

## 🛡️ SECURITY CHECKLIST

### Pre-Deployment

- [ ] All containers run as non-root
- [ ] HTTPS enabled with TLS 1.3
- [ ] Rate limiting active
- [ ] No secrets in code/repos
- [ ] Health checks working
- [ ] Logging configured
- [ ] Monitoring dashboards ready
- [ ] Alert routing configured

### Post-Deployment

- [ ] Verify all services healthy
- [ ] Test HTTPS redirect
- [ ] Confirm rate limiting works
- [ ] Check logs appearing in Grafana
- [ ] Test alert delivery (Slack/PagerDuty)
- [ ] Validate RBAC enforcement
- [ ] Run security scan

---

## 🎯 TROUBLESHOOTING

### Container Won't Start

```bash
# Check health endpoint
curl http://localhost:PORT/health

# View logs
docker logs <container-name>

# Check resource limits
docker stats <container-name>
```

### High Error Rate

```bash
# Check recent deployments
kubectl rollout history deployment/backend

# View error logs
kubectl logs -l app=edgecloud --tail=1000 | grep ERROR

# Check metrics
curl http://prometheus:9090/api/v1/query?query=rate(http_requests_total{status=~"5.."}[5m])
```

### Rate Limiting Issues

```bash
# Check nginx config
nginx -t

# View rate limit headers
curl -I https://api.edgecloud.io/api/test
# Look for: X-RateLimit-Limit, X-RateLimit-Remaining
```

---

## 📞 SUPPORT CONTACTS

### On-Call Rotation

- **Primary:** oncall@edgecloud.io
- **Secondary:** backup-oncall@edgecloud.io
- **Escalation:** engineering-leads@edgecloud.io

### Communication Channels

- **Slack:** #edgecloud-alerts (warnings)
- **Slack:** #critical-alerts (critical)
- **Email:** oncall@edgecloud.io
- **PagerDuty:** edgecloud-service

---

## 🚨 EMERGENCY PROCEDURES

### Service Down

1. Check health: `kubectl get pods -n production`
2. View logs: `kubectl logs <pod-name>`
3. Restart if needed: `kubectl rollout restart deployment/<name>`
4. Monitor: `kubectl rollout status deployment/<name>`

### Security Incident

1. **IMMEDIATE:** Rotate affected credentials
2. **ASSESS:** Determine scope of breach
3. **CONTAIN:** Isolate affected services
4. **INVESTIGATE:** Review audit logs
5. **REMEDIATE:** Apply fixes
6. **POST-MORTEM:** Document lessons learned

### Performance Degradation

1. Check metrics dashboard
2. Identify bottleneck (CPU/Memory/Network)
3. Scale horizontally if needed: `kubectl scale deployment/<name> --replicas=5`
4. Optimize queries/operations
5. Monitor recovery

---

## 📚 DOCUMENTATION INDEX

### Core Documents

- `INFRASTRUCTURE_UPGRADE_REPORT.md` - Full assessment
- `START_HERE.md` - Project overview
- `README-PRODUCTION.md` - Production guide
- `QUICKSTART.md` - Getting started

### Specialized Documents

- `SECURITY_FIXES_SUMMARY.md` - Security audit
- `RELIABILITY_FIXES_SUMMARY.md` - Reliability improvements
- `DEPLOYMENT_CHECKLIST.md` - Pre-flight checks
- `RUNBOOK.md` - Operations procedures

---

**Last Updated:** March 29, 2026  
**Version:** 1.0  
**Status:** ✅ PRODUCTION READY
