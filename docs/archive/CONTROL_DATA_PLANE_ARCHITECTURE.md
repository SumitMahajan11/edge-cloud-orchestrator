# Control Plane / Data Plane Architecture

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CONTROL PLANE                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         API Gateway Layer                                │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │   │
│  │  │   REST API  │  │  WebSocket  │  │   gRPC      │  │  Webhook    │    │   │
│  │  │   (HTTP)    │  │  (Realtime) │  │  (Internal) │  │  (Events)   │    │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │   │
│  │         └─────────────────┴─────────────────┴─────────────────┘         │   │
│  └──────────────────────────────────┬──────────────────────────────────────┘   │
│                                     │                                            │
│  ┌──────────────────────────────────┼──────────────────────────────────────┐   │
│  │                         Core Services                                   │   │
│  │  ┌─────────────────┐  ┌─────────┴──────────┐  ┌─────────────────┐      │   │
│  │  │                 │  │                    │  │                 │      │   │
│  │  │   Scheduler     │  │   Policy Engine    │  │  Node Registry  │      │   │
│  │  │   Service       │◄─┤   (Pluggable)      │◄─┤   & Health      │      │   │
│  │  │                 │  │                    │  │   Monitor       │      │   │
│  │  └────────┬────────┘  └────────────────────┘  └─────────────────┘      │   │
│  │           │                                                             │   │
│  │  ┌────────┴────────┐  ┌────────────────────┐  ┌─────────────────┐      │   │
│  │  │                 │  │                    │  │                 │      │   │
│  │  │   Task Queue    │  │   State Machine    │  │   Audit Log     │      │   │
│  │  │   (Priority)    │  │   (Lifecycle)      │  │   & Compliance  │      │   │
│  │  │                 │  │                    │  │                 │      │   │
│  │  └─────────────────┘  └────────────────────┘  └─────────────────┘      │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
│                                     │                                           │
│  ┌──────────────────────────────────┼──────────────────────────────────────┐  │
│  │                      Observability Stack                                │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │  │
│  │  │ Prometheus  │  │   Jaeger    │  │   Grafana   │  │   Alert     │    │  │
│  │  │  Metrics    │  │   Traces    │  │ Dashboards  │  │  Manager    │    │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  State: PostgreSQL (persistence) + Redis (coordination/cache)                 │
└────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         │ Control Commands (gRPC/mTLS)
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│                               DATA PLANE                                        │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         Edge Agent (Per Node)                            │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │   │
│  │  │                    Agent Control Loop                            │   │   │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │   │   │
│  │  │  │   gRPC      │  │   Local     │  │   Task      │             │   │   │
│  │  │  │   Client    │◄─┤   State     │◄─┤   Executor  │             │   │   │
│  │  │  │             │  │   Machine   │  │             │             │   │   │
│  │  │  └──────┬──────┘  └─────────────┘  └──────┬──────┘             │   │   │
│  │  │         │                                  │                    │   │   │
│  │  │         ▼                                  ▼                    │   │   │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │   │   │
│  │  │  │   Metrics   │  │   Resource  │  │   Container │             │   │   │
│  │  │  │   Collector │  │   Monitor   │  │   Runtime   │             │   │   │
│  │  │  │             │  │             │  │   (Docker)  │             │   │   │
│  │  │  └─────────────┘  └─────────────┘  └─────────────┘             │   │   │
│  │  └─────────────────────────────────────────────────────────────────┘   │   │
│  │                                                                          │   │
│  │  State: Local SQLite (caching) + In-memory metrics                      │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         Execution Environment                            │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │   │
│  │  │   Task      │  │   Task      │  │   Task      │  │   System    │    │   │
│  │  │   Container │  │   Container │  │   Container │  │   Processes │    │   │
│  │  │   (Isolated)│  │   (Isolated)│  │   (Isolated)│  │   (Agent)   │    │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────┘
```

## Real-World Parallels

### Kubernetes Architecture Comparison

| Component | Kubernetes | Edge-Cloud Orchestrator |
|-----------|------------|------------------------|
| Control Plane | kube-apiserver, etcd, scheduler, controller-manager | API Gateway, PostgreSQL, Scheduler Service, Policy Engine |
| Data Plane | kubelet (per node), container runtime | Edge Agent (per node), Docker runtime |
| Communication | etcd (state), API server (control) | PostgreSQL (state), gRPC (control) |
| Scheduling | Default + custom schedulers | Priority queue + pluggable policies |

### Nomad Architecture Comparison

| Component | Nomad | Edge-Cloud Orchestrator |
|-----------|-------|------------------------|
| Servers | Nomad servers (3-5 for HA) | Control Plane (API + Scheduler) |
| Clients | Nomad clients (per node) | Edge Agents (per node) |
| State | Raft consensus | PostgreSQL + Redis |
| Drivers | Docker, exec, Java, etc. | Docker containers |

### Key Differences from Kubernetes

1. **Simpler State Management**: PostgreSQL instead of etcd (easier ops)
2. **Edge-Optimized**: Designed for WAN latency, intermittent connectivity
3. **Task-Centric**: Focus on batch tasks vs long-running services
4. **Cost-Aware**: Built-in cost optimization policies

## Service Responsibilities

### Control Plane Services

#### 1. API Gateway
```typescript
// Responsibilities:
// - Authentication (JWT, API keys, mTLS)
// - Rate limiting
// - Request routing
// - Protocol translation (REST ↔ gRPC)

interface APIGateway {
  handleREST(request: HTTPRequest): Promise<HTTPResponse>
  handleWebSocket(connection: WSConnection): void
  handleGRPC(call: GRPCCall): Promise<GRPCResponse>
  authenticate(request: Request): Promise<Identity>
}
```

#### 2. Scheduler Service
```typescript
// Responsibilities:
// - Queue management (priority, fairness)
// - Node selection (policies: latency, cost, load)
// - Task placement decisions
// - Preemption (future)

interface SchedulerService {
  enqueue(task: Task): Promise<void>
  schedule(): Promise<SchedulingDecision>
  // PURE CONTROL PLANE: Makes decisions, never executes
}
```

#### 3. Policy Engine
```typescript
// Responsibilities:
// - Evaluate scheduling policies
// - Enforce resource quotas
// - Cost optimization
// - Affinity/anti-affinity rules

interface PolicyEngine {
  evaluate(task: Task, nodes: Node[]): Promise<PolicyResult>
  validateConstraints(task: Task): Promise<ValidationResult>
}
```

#### 4. Node Registry & Health Monitor
```typescript
// Responsibilities:
// - Node registration/deregistration
// - Health tracking (heartbeat processing)
// - Capacity tracking
// - Failure detection

interface NodeRegistry {
  register(node: NodeRegistration): Promise<void>
  updateHealth(nodeId: string, health: HealthStatus): Promise<void>
  getEligibleNodes(requirements: ResourceRequirements): Promise<Node[]>
  detectFailures(): Promise<Node[]>
}
```

#### 5. State Machine (Task Lifecycle)
```typescript
// Responsibilities:
// - Manage task state transitions
// - Handle timeouts and retries
// - Maintain execution history

interface TaskStateMachine {
  transition(taskId: string, event: TaskEvent): Promise<State>
  // States: PENDING → SCHEDULED → RUNNING → COMPLETED/FAILED
}
```

### Data Plane Services

#### 1. Edge Agent
```typescript
// Responsibilities:
// - Maintain connection to control plane
// - Receive task assignments
// - Report status and metrics
// - Local task queue management

interface EdgeAgent {
  connect(controlPlaneURL: string): Promise<void>
  receiveTask(assignment: TaskAssignment): Promise<void>
  reportStatus(): Promise<NodeStatus>
  // PURE DATA PLANE: Executes, never decides
}
```

#### 2. Task Executor
```typescript
// Responsibilities:
// - Pull container images
// - Start/stop containers
// - Stream logs
// - Report completion/failure

interface TaskExecutor {
  execute(spec: TaskSpec): Promise<ExecutionResult>
  cancel(taskId: string): Promise<void>
  getStatus(taskId: string): Promise<TaskStatus>
}
```

#### 3. Metrics Collector
```typescript
// Responsibilities:
// - Collect system metrics (CPU, memory, disk, network)
// - Aggregate container metrics
// - Report to control plane

interface MetricsCollector {
  collect(): Promise<SystemMetrics>
  report(metrics: SystemMetrics): Promise<void>
}
```

## Task Flow Through the System

```
User submits task
       │
       ▼
┌─────────────────┐
│  API Gateway    │──► Auth check, rate limit
│  (Control Plane)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Task State     │──► Create Task record (PENDING)
│  Machine        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Task Queue     │──► Add to priority queue (Redis)
│  (Control Plane)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  Scheduler      │────►│  Policy Engine  │
│  (Control Plane)│     │  (Control Plane)│
└────────┬────────┘     └─────────────────┘
         │
         │ Evaluate policies, select node
         ▼
┌─────────────────┐
│  Node Registry  │──► Check node health, capacity
│  (Control Plane)│
└────────┬────────┘
         │
         │ Create TaskExecution record (SCHEDULED)
         ▼
┌─────────────────┐
│  gRPC Client    │──► Send TaskAssignment to Edge Agent
│  (Control Plane)│
└────────┬────────┘
         │ mTLS-secured gRPC stream
         ▼
┌─────────────────┐
│  Edge Agent     │──► Receive assignment, acknowledge
│  (Data Plane)   │
└────────┬────────┘
         │
         │ Update TaskExecution (RUNNING)
         ▼
┌─────────────────┐
│  Task Executor  │──► Pull image, start container
│  (Data Plane)   │
└────────┬────────┘
         │
         │ Stream logs, collect metrics
         ▼
┌─────────────────┐
│  Container      │──► Execute task logic
│  (Isolated)     │
└────────┬────────┘
         │
         │ Task completes
         ▼
┌─────────────────┐
│  Task Executor  │──► Capture exit code, output
│  (Data Plane)   │
└────────┬────────┘
         │
         │ Report completion via gRPC
         ▼
┌─────────────────┐
│  API Gateway    │──► Receive completion webhook
│  (Control Plane)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Task State     │──► Update TaskExecution (COMPLETED/FAILED)
│  Machine        │    Update Task status
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Webhook        │──► Notify external systems
│  Dispatcher     │
└─────────────────┘
```

## Folder Structure

```
edge-cloud-orchestrator/
├── control-plane/                    # Control Plane Code
│   ├── src/
│   │   ├── api/                     # API Gateway
│   │   │   ├── rest/                # REST endpoints
│   │   │   ├── websocket/           # WebSocket handlers
│   │   │   ├── grpc/                # gRPC service
│   │   │   └── middleware/          # Auth, rate limiting
│   │   ├── scheduler/               # Scheduling logic
│   │   │   ├── queue/               # Task queue implementations
│   │   │   ├── policies/            # Scheduling policies
│   │   │   └── scheduler.ts         # Main scheduler service
│   │   ├── policy-engine/           # Policy evaluation
│   │   │   ├── constraints/         # Resource constraints
│   │   │   ├── cost/                # Cost optimization
│   │   │   └── engine.ts            # Policy engine
│   │   ├── node-registry/           # Node management
│   │   │   ├── health/              # Health checking
│   │   │   ├── registry.ts          # Node registry
│   │   │   └── monitor.ts           # Health monitor
│   │   ├── state-machine/           # Task lifecycle
│   │   │   ├── states/              # State definitions
│   │   │   ├── transitions/         # State transitions
│   │   │   └── machine.ts           # State machine
│   │   ├── observability/           # Metrics & tracing
│   │   │   ├── metrics/             # Prometheus metrics
│   │   │   ├── tracing/             # OpenTelemetry traces
│   │   │   └── logging/             # Structured logging
│   │   └── database/                # Database access
│   │       ├── migrations/          # Schema migrations
│   │       ├── repositories/        # Data access layer
│   │       └── prisma/
│   ├── package.json
│   └── tsconfig.json
│
├── data-plane/                       # Data Plane Code
│   ├── agent/                        # Edge Agent
│   │   ├── src/
│   │   │   ├── agent.ts             # Main agent loop
│   │   │   ├── grpc-client/         # Control plane connection
│   │   │   ├── executor/            # Task execution
│   │   │   │   ├── docker.ts        # Docker runtime
│   │   │   │   ├── runner.ts        # Task runner
│   │   │   │   └── logs.ts          # Log streaming
│   │   │   ├── metrics/             # Metrics collection
│   │   │   │   ├── collector.ts     # System metrics
│   │   │   │   └── reporter.ts      # Metrics reporter
│   │   │   ├── state/               # Local state
│   │   │   │   ├── store.ts         # SQLite store
│   │   │   │   └── cache.ts         # In-memory cache
│   │   │   └── runtime/             # Container runtime
│   │   ├── package.json
│   │   └── Dockerfile
│   │
│   └── runtime/                      # Container Images
│       ├── image-classifier/
│       ├── data-aggregator/
│       └── log-analyzer/
│
├── shared/                           # Shared Code
│   ├── src/
│   │   ├── types/                   # Shared TypeScript types
│   │   ├── proto/                   # gRPC protobuf definitions
│   │   ├── constants/               # Shared constants
│   │   └── utils/                   # Shared utilities
│   └── package.json
│
├── infrastructure/                   # Deployment
│   ├── docker/                      # Docker Compose
│   ├── kubernetes/                  # K8s manifests
│   └── terraform/                   # Infrastructure as Code
│
└── docs/                            # Documentation
    ├── ARCHITECTURE.md
    ├── CONTROL_DATA_PLANE.md
    └── API.md
```

## Communication Patterns

### Control Plane → Data Plane (Commands)

```protobuf
// proto/control_plane.proto
service ControlPlane {
  // Stream task assignments to agent
  rpc StreamAssignments(AgentIdentity) returns (stream TaskAssignment);
  
  // Cancel running task
  rpc CancelTask(CancelRequest) returns (CancelResponse);
  
  // Update agent configuration
  rpc UpdateConfig(ConfigUpdate) returns (ConfigAck);
}

message TaskAssignment {
  string execution_id = 1;
  string task_id = 2;
  TaskSpec spec = 3;
  int64 deadline = 4;  // Unix timestamp
}
```

### Data Plane → Control Plane (Reports)

```protobuf
// proto/data_plane.proto
service DataPlane {
  // Report task status
  rpc ReportStatus(StatusReport) returns (Ack);
  
  // Stream metrics
  rpc StreamMetrics(AgentIdentity) returns (stream MetricsBatch);
  
  // Send task completion
  rpc TaskCompleted(CompletionReport) returns (Ack);
}

message StatusReport {
  string agent_id = 1;
  NodeStatus status = 2;
  repeated TaskStatus tasks = 3;
  ResourceMetrics resources = 4;
  int64 timestamp = 5;
}
```

## Scalability Improvements

### 1. Horizontal Scaling

```
Before (Monolithic):
┌─────────────────┐
│  Single API     │
│  + Scheduler    │
│  + Everything   │
└─────────────────┘

After (Microservices):
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  API        │  │  Scheduler  │  │  Policy     │
│  Instances  │  │  Instances  │  │  Engine     │
│  (x3)       │  │  (x2)       │  │  (x2)       │
└─────────────┘  └─────────────┘  └─────────────┘
       │                │                │
       └────────────────┴────────────────┘
                          │
                    ┌─────────────┐
                    │   Shared    │
                    │   State     │
                    │ (PostgreSQL)│
                    └─────────────┘
```

### 2. Reliability Improvements

| Aspect | Before | After |
|--------|--------|-------|
| Control Plane | Single point of failure | Multiple instances + leader election |
| State | In-memory only | PostgreSQL + Redis (persistent) |
| Node Communication | HTTP polling | gRPC streaming (efficient) |
| Task Recovery | Lost on restart | Persistent queue + execution records |
| Deployment | Downtime on update | Rolling updates, zero downtime |

### 3. Performance Gains

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Scheduling Latency | 500ms | 50ms | 10x |
| Task Throughput | 10/sec | 100/sec | 10x |
| Node Scale | 10 nodes | 1000 nodes | 100x |
| Recovery Time | 5 minutes | 30 seconds | 10x |

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
1. Create folder structure
2. Set up gRPC protobuf definitions
3. Implement basic control plane API
4. Create edge agent skeleton

### Phase 2: Core Loop (Week 3-4)
1. Implement scheduler service
2. Build task queue (Redis)
3. Create state machine
4. Basic task execution

### Phase 3: Production (Week 5-6)
1. Add observability stack
2. Implement health monitoring
3. Add mTLS security
4. Performance optimization

### Phase 4: Scale (Week 7-8)
1. Horizontal scaling
2. Advanced scheduling policies
3. Multi-region support
4. Disaster recovery

---

**Document Version**: 1.0  
**Last Updated**: March 2026  
**Status**: Architecture Design Complete
