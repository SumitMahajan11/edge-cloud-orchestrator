# Edge-Cloud Orchestrator Architecture

## System Overview

### System Diagram

```mermaid
graph LR
    User["User (Dashboard)"]
    GW["API Gateway (Nginx)"]
    API["API Service REST endpoints"]
    TS["Task Service Task lifecycle"]
    SS["Scheduler ML-driven placement"]
    NS["Node Service Heartbeat aggregation"]
    WS["WebSocket Real-time push"]
    MS["Metrics Prometheus aggregation"]

    DB["PostgreSQL 16 Persistent state"]
    Redis["Redis 7 Cache + Streams"]

    User -->|HTTP| GW
    GW -->|Request| API
    API -->|State| DB
    API -->|Cache| Redis
    API -->|Publish| Redis
    TS -->|Consume| Redis
    SS -->|Subscribe| Redis
    SS -->|Assign| WS
    NS -->|Aggregate HB| DB
    MS -->|Scrape| API
    MS -->|Scrape| TS
    MS -->|Scrape| SS
    MS -->|Scrape| NS
```

### Service Port Map

| Service | Port | Protocol |
|---|---|---|
| api | 3000 | HTTP/REST |
| task-service | 3001 | HTTP + Redis Streams |
| websocket-gateway | 3002 | WebSocket |
| scheduler-service | 3003 | HTTP + Redis Streams |
| node-service | 3004 | HTTP + gRPC |
| metrics-service | 3005 | HTTP (Prometheus) |
| api-gateway (Nginx) | 8080 | HTTP (reverse proxy) |

### Data Flow

1. User submits task via dashboard → API stores in PostgreSQL as `PENDING`
2. Task service publishes `task.created` event to Redis Streams
3. Scheduler consumes event, runs ML model, selects optimal node
4. Scheduler publishes `task.scheduled` event + sends assignment via WebSocket
5. Edge agent receives assignment, starts container
6. Agent publishes heartbeats to Node Service every 5 seconds
7. Node Service batches heartbeats, flushes to PostgreSQL every 5 seconds
8. Metrics Service scrapes all `/metrics` endpoints, aggregates at `:3005`
9. Prometheus scrapes `metrics-service`; Grafana displays dashboards

### High Availability

| Service | Replicas (prod) | Strategy |
|---|---|---|
| scheduler-service | 3 | Leader election via Redlock (Redis) |
| task-service | 3 | Stateless, load-balanced by Nginx |
| node-service | 2 | Async batching; one replica can be down without data loss |
| api | 2 | Stateless |
| PostgreSQL | 1 + daily S3 backups | Manual promotion on failure |
| Redis | 1 + AOF persistence | Manual failover |

### Scaling Limits (Validated)

| Dimension | Limit | Notes |
|---|---|---|
| Nodes | 50,000 | Async heartbeat batching in node-service |
| Total tasks | 1,000,000 | DB-dependent; configure retention policy |
| Scheduling throughput | 500 tasks/sec | ML model + Redis Streams pipeline |
| P99 scheduling latency | <50ms | Measured at scheduler-service |

### Network Security

- All inter-service communication is **mTLS** (mandatory in production; disabled in development with `MTLS_ENABLED=false`)
- Edge agents communicate to cloud services via **mTLS + HMAC-signed task payloads**
- No plaintext HTTP traffic is permitted between services in production
- Certificates issued by Vault PKI engine; stored in Kubernetes Secrets (not Git)

---

## Control Plane vs Data Plane Separation

### Control Plane Components

Responsible for **decision making**, **coordination**, and **state management**.

```
┌─────────────────────────────────────────────────────────────────┐
│                      CONTROL PLANE                               │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   API       │  │  Scheduler  │  │   Policy    │             │
│  │  Gateway    │  │   Engine    │  │   Engine    │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐             │
│  │   Auth      │  │   Task      │  │   Node      │             │
│  │   Service   │  │   Queue     │  │   Registry  │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
│  State: PostgreSQL + Redis (coordination)                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Control Commands (gRPC/HTTPS)
                              ▼
```

**Control Plane Responsibilities:**
- Task scheduling decisions
- Node registration and health tracking
- Policy evaluation
- Authentication and authorization
- Audit logging
- Webhook delivery

### Data Plane Components

Responsible for **task execution**, **metrics collection**, and **local state**.

```
┌─────────────────────────────────────────────────────────────────┐
│                       DATA PLANE                                 │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Edge      │  │   Task      │  │   Metrics   │             │
│  │   Agent     │  │   Executor  │  │   Collector │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐             │
│  │   Local     │  │   Docker    │  │   System    │             │
│  │   Queue     │  │   Runtime   │  │   Monitor   │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
│  State: Local SQLite (caching) + In-memory metrics             │
└─────────────────────────────────────────────────────────────────┘
```

**Data Plane Responsibilities:**
- Task execution in containers
- Resource metrics collection (CPU, memory, network)
- Local task queue buffering
- Heartbeat reporting
- Container lifecycle management

### Communication Patterns

| Direction | Protocol | Purpose | Payload |
|-----------|----------|---------|---------|
| CP → DP | gRPC/HTTPS | Task assignment | Task spec, container image |
| DP → CP | gRPC/HTTPS | Heartbeat + metrics | Node status, resource usage |
| DP → CP | WebSocket | Real-time events | Task completion, errors |
| CP → CP | Redis Pub/Sub | Coordination | Scheduling decisions |

### Why This Separation Matters

1. **Independent Scaling**: Scale control plane for scheduling throughput, data plane for execution capacity
2. **Fault Isolation**: Control plane failures don't affect running tasks
3. **Security**: Different threat models (CP has secrets, DP runs untrusted code)
4. **Deployment**: Update control plane without affecting task execution
5. **Testing**: Test scheduling logic without actual task execution

## Implementation Guidelines

### Control Plane Service Boundaries

```typescript
// Control Plane: Scheduler Service
// Only makes decisions, never executes tasks
interface SchedulerService {
  scheduleTask(task: Task): Promise<SchedulingDecision>
  evaluatePolicies(task: Task, nodes: Node[]): Promise<PolicyResult>
  // No task execution logic here
}

// Control Plane: Node Registry
// Tracks node state, doesn't manage node lifecycle
interface NodeRegistry {
  registerNode(node: NodeRegistration): Promise<void>
  updateHealth(nodeId: string, health: HealthStatus): Promise<void>
  getEligibleNodes(requirements: ResourceRequirements): Promise<Node[]>
}
```

### Data Plane Service Boundaries

```typescript
// Data Plane: Task Executor
// Only executes, never makes scheduling decisions
interface TaskExecutor {
  execute(task: TaskSpec): Promise<ExecutionResult>
  cancel(taskId: string): Promise<void>
  getStatus(taskId: string): Promise<TaskStatus>
}

// Data Plane: Metrics Collector
// Collects and reports, doesn't analyze
interface MetricsCollector {
  collect(): Promise<SystemMetrics>
  report(metrics: SystemMetrics): Promise<void>
}
```
