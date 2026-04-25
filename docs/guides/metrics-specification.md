# Monitoring Metrics Specification

## Metric Categories

### 1. Control Plane Metrics

| Metric Name | Type | Unit | Description | Labels |
|-------------|------|------|-------------|--------|
| `orchestrator_scheduling_decisions_total` | Counter | - | Total scheduling decisions made | policy, result |
| `orchestrator_scheduling_duration_seconds` | Histogram | seconds | Time to make scheduling decision | policy |
| `orchestrator_queue_depth` | Gauge | tasks | Current tasks in queue | priority |
| `orchestrator_api_requests_total` | Counter | - | Total API requests | method, endpoint, status |
| `orchestrator_api_request_duration_seconds` | Histogram | seconds | API request latency | method, endpoint |
| `orchestrator_active_nodes` | Gauge | nodes | Currently online nodes | region, status |
| `orchestrator_task_executions_total` | Counter | - | Total task executions | status, type |

### 2. Data Plane Metrics (Node)

| Metric Name | Type | Unit | Description | Labels |
|-------------|------|------|-------------|--------|
| `edge_node_cpu_usage_percent` | Gauge | percent | CPU utilization | node_id, core |
| `edge_node_memory_usage_bytes` | Gauge | bytes | Memory usage | node_id, type |
| `edge_node_storage_usage_bytes` | Gauge | bytes | Disk usage | node_id, mount |
| `edge_node_network_receive_bytes` | Counter | bytes | Network ingress | node_id, interface |
| `edge_node_network_transmit_bytes` | Counter | bytes | Network egress | node_id, interface |
| `edge_node_tasks_running` | Gauge | tasks | Currently running tasks | node_id |
| `edge_node_task_duration_seconds` | Histogram | seconds | Task execution time | node_id, type |
| `edge_node_container_start_duration_seconds` | Histogram | seconds | Container startup time | node_id |

### 3. Task Execution Metrics

| Metric Name | Type | Unit | Description | Labels |
|-------------|------|------|-------------|--------|
| `task_execution_duration_seconds` | Histogram | seconds | Total task execution time | task_type, status |
| `task_queue_wait_seconds` | Histogram | seconds | Time spent in queue | priority |
| `task_resource_cpu_seconds` | Counter | seconds | CPU time consumed | task_id, node_id |
| `task_resource_memory_max_bytes` | Gauge | bytes | Peak memory usage | task_id, node_id |
| `task_cost_usd` | Gauge | dollars | Actual execution cost | task_id, node_id |
| `task_retry_count` | Counter | - | Number of retries | task_id, reason |

### 4. Business Metrics

| Metric Name | Type | Unit | Description |
|-------------|------|------|-------------|
| `cost_total_usd` | Counter | dollars | Total infrastructure cost |
| `cost_by_region_usd` | Counter | dollars | Cost per region | region |
| `sla_uptime_percent` | Gauge | percent | System uptime |
| `sla_task_success_rate` | Gauge | percent | Task success percentage |

## Metric Collection Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Edge      │────►│  Prometheus │────►│   Grafana   │
│   Agents    │     │  Scraper    │     │  Dashboard  │
└─────────────┘     └─────────────┘     └─────────────┘
       │
       │ OpenTelemetry
       ▼
┌─────────────┐     ┌─────────────┐
│   Jaeger    │────►│   Traces    │
│   Collector │     │  (Tempo)    │
└─────────────┘     └─────────────┘
```

## Implementation

### Node Metrics Exporter

```typescript
// Edge agent metrics endpoint
app.get('/metrics', async (req, res) => {
  const metrics = await collectSystemMetrics()
  const output = []
  
  // CPU metrics
  output.push(`# HELP edge_node_cpu_usage_percent CPU utilization`)
  output.push(`# TYPE edge_node_cpu_usage_percent gauge`)
  output.push(`edge_node_cpu_usage_percent{node_id="${NODE_ID}"} ${metrics.cpu.usage}`)
  
  // Memory metrics
  output.push(`# HELP edge_node_memory_usage_bytes Memory usage`)
  output.push(`# TYPE edge_node_memory_usage_bytes gauge`)
  output.push(`edge_node_memory_usage_bytes{node_id="${NODE_ID}",type="used"} ${metrics.memory.used}`)
  output.push(`edge_node_memory_usage_bytes{node_id="${NODE_ID}",type="total"} ${metrics.memory.total}`)
  
  res.set('Content-Type', 'text/plain')
  res.send(output.join('\n'))
})
```

### OpenTelemetry Instrumentation

```typescript
// Control plane tracing
const tracer = opentelemetry.trace.getTracer('orchestrator')

async function scheduleTask(task: Task) {
  return tracer.startActiveSpan('scheduleTask', async (span) => {
    span.setAttribute('task.id', task.id)
    span.setAttribute('task.type', task.type)
    
    try {
      const node = await findNode(task)
      span.setAttribute('node.id', node.id)
      
      await assignTask(task, node)
      span.setStatus({ code: SpanStatusCode.OK })
    } catch (error) {
      span.recordException(error)
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw error
    } finally {
      span.end()
    }
  })
}
```

## Alerting Rules

```yaml
# High CPU usage
- alert: HighCPUUsage
  expr: edge_node_cpu_usage_percent > 80
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "High CPU usage on {{ $labels.node_id }}"

# Node offline
- alert: NodeOffline
  expr: edge_node_heartbeat_timestamp < (time() - 300)
  for: 1m
  labels:
    severity: critical
  annotations:
    summary: "Node {{ $labels.node_id }} is offline"

# Task failure rate
- alert: HighTaskFailureRate
  expr: rate(task_executions_total{status="failed"}[5m]) > 0.1
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "High task failure rate"
```
