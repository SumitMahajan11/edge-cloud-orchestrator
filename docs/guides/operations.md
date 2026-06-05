# Operations Guide

## Dead Letter Queue (DLQ) Management

### Overview

The Dead Letter Queue stores events that failed processing after maximum retries. Events are stored in both PostgreSQL and Redis Streams for durability and fast inspection.

### DLQ Architecture

```
Event Processing → Retry (3x) → DLQ Storage
                                    ├── PostgreSQL (permanent)
                                    ├── Redis Streams DLQ Topic (streaming)
                                    └── Redis Streams (fast inspection)
```

### Monitoring DLQ Size

#### Redis CLI (Real-time)

```bash
# Check DLQ size for a specific stream
redis-cli XLEN edgecloud-events:dlq

# Check multiple streams
redis-cli XLEN tasks.commands:dlq
redis-cli XLEN tasks.events:dlq
redis-cli XLEN nodes.events:dlq
```

#### API Endpoint

```bash
# Get DLQ stats across all streams
curl http://api.edgecloud.io/admin/dlq/stats \
  -H "Authorization: Bearer <admin-token>"
```

Response:

```json
{
  "totalEvents": 42,
  "pendingRetry": 15,
  "permanentlyFailed": 20,
  "reprocessed": 7,
  "byTopic": {
    "tasks.commands": 25,
    "nodes.events": 17
  },
  "redisStreams": {
    "tasks.commands:dlq": 25,
    "nodes.events:dlq": 17
  }
}
```

### Inspecting Failed Events

#### Redis CLI

```bash
# View all events in DLQ
redis-cli XRANGE edgecloud-events:dlq - +

# View last 10 events
redis-cli XREVRANGE edgecloud-events:dlq + - COUNT 10

# Inspect specific event by ID
redis-cli XRANGE edgecloud-events:dlq 1234567890123-0 1234567890123-0
```

Example output:

```
1) 1) "1719123456789-0"
   2) 1) "eventId"
      2) "dlq-1719123456-abc123"
      3) "event"
      4) "{\"taskId\":\"task-456\",\"status\":\"completed\"}"
      5) "error"
      6) "Database connection timeout"
      7) "failedAt"
      8) "2026-04-25T10:30:00.000Z"
      9) "retries"
      10) "3"
```

#### API Endpoint

```bash
# List failed events
curl "http://api.edgecloud.io/admin/dlq/events?topic=tasks.commands&limit=50" \
  -H "Authorization: Bearer <admin-token>"

# Get specific event
curl http://api.edgecloud.io/admin/dlq/events/<event-id> \
  -H "Authorization: Bearer <admin-token>"
```

### Manually Retrying Events

#### From Redis Streams

```bash
# 1. Inspect the event
redis-cli XRANGE tasks.commands:dlq <event-id> <event-id>

# 2. Republish to original stream (manual)
redis-cli XADD tasks.commands '*' event '<event-data>'

# 3. Remove from DLQ
redis-cli XDEL tasks.commands:dlq <event-id>
```

#### Using API

```bash
# Retry a single event
curl -X POST http://api.edgecloud.io/admin/dlq/events/<event-id>/retry \
  -H "Authorization: Bearer <admin-token>"

# Retry multiple events
curl -X POST http://api.edgecloud.io/admin/dlq/events/retry \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"eventIds": ["evt-1", "evt-2", "evt-3"]}'

# Retry all pending events for a topic
curl -X POST http://api.edgecloud.io/admin/dlq/topics/tasks.commands/retry-all \
  -H "Authorization: Bearer <admin-token>"
```

### Alerting on DLQ Accumulation

#### Prometheus Metrics

```prometheus
# DLQ size per stream
event_dlq_size{stream="tasks.commands:dlq"} 25
event_dlq_size{stream="nodes.events:dlq"} 17

# Events added to DLQ (rate)
rate(event_dlq_total[5m])  # events per second
```

#### Alert Rules

```yaml
# In monitoring/alerts.yml
groups:
  - name: dlq_alerts
    rules:
      - alert: DLQSizeHigh
        expr: event_dlq_size > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "DLQ size exceeds threshold"
          description: "Stream {{ $labels.stream }} has {{ $value }} events in DLQ"

      - alert: DLQGrowingRapidly
        expr: rate(event_dlq_total[5m]) > 10
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "DLQ growing rapidly"
          description: "{{ $value }} events/sec being added to DLQ"
```

#### Grafana Dashboard

Dashboard ID: `edgecloud-dlq-monitoring`

Panels:

1. **DLQ Size by Stream** (Time series)
2. **DLQ Events Added Rate** (Gauge)
3. **Retry Success Rate** (Percentage)
4. **Top Error Messages** (Table)

### Purging Old DLQ Events

#### API Endpoint

```bash
# Purge events older than 7 days
curl -X POST http://api.edgecloud.io/admin/dlq/purge \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"olderThanDays": 7}'
```

#### Manual Cleanup (Redis)

```bash
# Trim DLQ stream to keep only last 1000 events
redis-cli XTRIM edgecloud-events:dlq MAXLEN 1000

# Delete entire DLQ stream (DANGER: irreversible)
redis-cli DEL edgecloud-events:dlq
```

### Common DLQ Errors

| Error Pattern                         | Root Cause                 | Resolution                              |
| ------------------------------------- | -------------------------- | --------------------------------------- |
| `Database connection timeout`         | DB pool exhaustion         | Increase pool size, check DB health     |
| `External API rate limit`             | Third-party throttling     | Implement backoff, contact API provider |
| `Invalid event schema`                | Bug in publisher           | Fix event schema, redeploy              |
| `Handler undefined is not a function` | Code deployment issue      | Rollback deployment, fix bug            |
| `Connection refused`                  | Downstream service offline | Restart service, check network          |

### DLQ Best Practices

1. **Monitor Daily**: Check DLQ size as part of daily ops routine
2. **Set Alerts**: Configure alerts for DLQ > 100 events
3. **Investigate Patterns**: Group errors by message to find root causes
4. **Retry Strategically**: Don't blindly retry; fix root cause first
5. **Purge Regularly**: Remove old events to save storage
6. **Document Resolutions**: Keep runbook for common DLQ issues

## Task Timeout Management

### Monitoring Task Timeouts

#### Prometheus Metrics

```prometheus
# Task timeout rate
rate(task_timeout_total[5m])

# Task execution duration histogram
histogram_quantile(0.95, rate(task_execution_duration_seconds_bucket[5m]))

# Tasks killed by timeout
task_killed_by_timeout_total
```

#### Grafana Dashboard

Dashboard ID: `edgecloud-task-monitoring`

Panels:

1. **Task Execution Duration** (Heatmap)
2. **Timeout Rate** (Time series)
3. **Top Timeout Task Types** (Bar chart)
4. **SIGTERM vs SIGKILL Ratio** (Pie chart)

### Adjusting Timeouts

#### Identify Tasks Needing Adjustment

```bash
# Get tasks with highest timeout rate
curl "http://api.edgecloud.io/admin/tasks/timeout-stats?period=7d" \
  -H "Authorization: Bearer <admin-token>"
```

#### Update Default Timeout

In `apps/api/prisma/schema.prisma`:

```prisma
model Task {
  maxDurationSeconds Int @default(3600) // Adjust default
}
```

Then run migration:

```bash
pnpm --filter api exec prisma migrate dev --name adjust_task_timeout
```

### Emergency: Kill Runaway Tasks

```bash
# Cancel a specific task
curl -X POST http://api.edgecloud.io/tasks/<task-id>/cancel \
  -H "Authorization: Bearer <admin-token>"

# Cancel all running tasks on a node
curl -X POST http://api.edgecloud.io/nodes/<node-id>/cancel-all-tasks \
  -H "Authorization: Bearer <admin-token>"
```

## Incident Response

### DLQ Overflow (>1000 events)

1. **Acknowledge Alert**: Set incident status to "investigating"
2. **Check DLQ Dashboard**: Identify top error patterns
3. **Stop the Bleeding**:
   ```bash
   # Pause event publishing if systemic issue
   curl -X POST http://api.edgecloud.io/admin/pause-events \
     -H "Authorization: Bearer <admin-token>"
   ```
4. **Fix Root Cause**: Deploy fix or rollback
5. **Retry Events**:
   ```bash
   curl -X POST http://api.edgecloud.io/admin/dlq/retry-all \
     -H "Authorization: Bearer <admin-token>"
   ```
6. **Monitor Recovery**: Watch DLQ size decrease
7. **Post-Mortem**: Document incident and preventive measures

### Task Timeout Spike

1. **Check Metrics**: Identify if spike is isolated or widespread
2. **Review Recent Changes**: Check deployments in last hour
3. **Check Node Health**:
   ```bash
   curl http://api.edgecloud.io/nodes/<node-id>/metrics
   ```
4. **Increase Timeouts Temporarily**: If legitimate workload increase
5. **Scale Out**: Add more nodes if resource contention
6. **Investigate**: Profile slow tasks, optimize code
