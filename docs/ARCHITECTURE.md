# Edge-Cloud Orchestrator Architecture

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
