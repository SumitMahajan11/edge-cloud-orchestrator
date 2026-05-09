# Edge-Cloud Compute Orchestrator

A production-grade distributed system for orchestrating compute workloads across heterogeneous edge nodes and cloud clusters. Features ML-driven task scheduling via Raft consensus, mTLS mutual authentication, real-time observability, and a React dashboard — all structured as a pnpm monorepo.

## Quick Start

```sh
cp config/.env.example config/.env.local   # fill in DATABASE_URL, JWT_SECRET, REDIS_URL
docker compose -f infra/docker/docker-compose.yml up -d
pnpm install && pnpm --filter web dev
```

Open `http://localhost:5173` — the dashboard connects to the API at `http://localhost:3090`.


## Services

| Service             | Port | Responsibility                                       | Docs                                          |
|---------------------|------|------------------------------------------------------|-----------------------------------------------|
| `api`               | 3090 | Unified Control Plane: scheduling, node registry, auth| [README](apps/api/README.md)                  |
| `web`               | 5173 | React 18 dashboard (dev), static bundle (prod)       | [README](apps/web/README.md)                  |
| `agent`             | 4001+| Edge node agent — heartbeat, task execution, mTLS    | [README](apps/agent/README.md)                |
| `websocket-gateway` | 3004 | Real-time WebSocket broadcast for dashboard          | [README](apps/websocket-gateway/README.md)    |
| `metrics-service`   | 3005 | Prometheus metrics aggregation and export            | [README](apps/metrics-service/README.md)      |
| `api-gateway`       | 443  | Nginx reverse proxy, TLS termination, static assets  | [README](apps/api-gateway/README.md)          |

> [!NOTE]
> As of v2.0.0, the `scheduler-service`, `node-service`, and `task-service` have been consolidated into the core `api` service to reduce inter-service latency and simplify deployment topology.

## Packages

| Package              | Purpose                                                    | Key Exports                             |
|----------------------|------------------------------------------------------------|-----------------------------------------|
| `shared-kernel`      | Core domain types and shared utilities                     | `EdgeNode`, `Task`, `createLogger`      |
| `circuit-breaker`    | Circuit breakers, retry, bulkhead, checkpointing           | `CircuitBreaker`, `RetryManager`        |
| `event-bus`          | Kafka-backed event bus with DLQ                            | `EventBus`, `DeadLetterQueue`           |
| `observability`      | OpenTelemetry tracing, Prometheus metrics, Pino logging    | `initTelemetry`, `MetricsRegistry`      |
| `security`           | RBAC/ABAC, mTLS, JWT, Vault client                         | `AbacEngine`, `VaultClient`             |
| `ml-scheduler`       | TensorFlow.js ML node scoring and drift detection          | `MLScheduler`, `DriftDetector`          |
| `scheduling-utils`   | Gang scheduling, preemption, bin-packing algorithms        | `selectNode`, `SchedulingError`         |
| `sandbox`            | Docker/gVisor/Firecracker sandboxed task runtimes          | `SandboxFactory`, `SandboxRuntime`      |
| `outbox`             | Transactional outbox pattern for reliable event publishing | `OutboxManager`, `OutboxRelay`          |
| `saga`               | Distributed saga orchestration with compensation           | `SagaOrchestrator`, `SagaStep`          |
| `performance`        | Redis caching, connection pooling, backpressure            | `CacheManager`, `ConnectionPool`        |
| `analytics`          | Windowed stream processing over Kafka                      | `StreamProcessor`, `TelemetrySink`      |
| `chaos`              | Chaos engineering: latency, crash, partition injection     | `ChaosEngine`, `NetworkChaos`           |
| `integration`        | DI container wiring all packages together                  | `ServiceContainer`, `bootstrap`         |
| `scheduler`          | Raft-aware advanced scheduling with reservations           | `AdvancedScheduler`, `FairShareQueue`   |
| `websocket-client`   | Resilient browser WS client with SSE fallback              | `WebSocketClient`, `ConnectionState`    |

## Contributing

See [docs/guides/contributing.md](docs/guides/contributing.md) for branch strategy, commit conventions, and PR checklist.

## Deployment

See [docs/guides/deployment.md](docs/guides/deployment.md) for Kubernetes deployment with Kustomize/ArgoCD, cert rotation, and production runbook.
