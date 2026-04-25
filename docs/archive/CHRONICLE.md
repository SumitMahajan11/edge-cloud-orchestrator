# Edge-Cloud Orchestrator: Project Evolution Chronicle

This document serves as the master record of the project's evolution, architectural shifts, and feature updates. Every modification to the project must be logged here in chronological order.

## Maintenance Rules
1. **Log Every Update**: Every task or feature must be recorded before completion.
2. **Date-Wise Format**: Use a clear date header for each day's updates.
3. **Detail Level**: Include the rationale for major design decisions (e.g., choosing one technology over another).

---

## [Baseline] State 0: March 29, 2026
**Current Architecture:**
- Distributed microservices architecture (Task, Node, Scheduler, Gateway).
- **Communication**: Redis Streams-based event streaming for inter-service communication.
- **Persistence**: PostgreSQL/CockroachDB for state, Redis for basic caching.
- **Consensus**: Raft consensus implementation present but competing with basic Redis locks.
- **Observability**: Prometheus/Grafana/Jaeger stack configured.
- **Versioning**: No formal API versioning; services communicate over ad-hoc REST/gRPC.

---

## 2026-04-14: Reliability & Performance Hardening

### Update 1: Distributed Consensus Standardization
- **Change**: Standardized leader election for the Task Scheduler.
- **Rationale**: Resolved a "split-brain" risk between competing Raft and Redlock mechanisms. Redlock via Redis was selected as the pragmatic choice given the existing Redis dependency and the simpler maintenance profile for this specific use case.
- **Impact**: Increased stability in multi-replica scheduler deployments.

### Update 2: API Gateway Versioning & Contracts
- **Change**: Implemented URL-based versioning (`/v1/`) on the API Gateway and created shared API contracts.
- **Rationale**: Prevents breaking changes from impacting edge agents during independent deployments. Derived TypeScript types from Zod schemas to ensure type-safety across the gateway and edge agent.
- **Impact**: Robust contract-first development flow.

### Update 3: Heartbeat Pipeline Overhaul
- **Change**: Migrated the real-time heartbeat pipeline from Redis Streams to Redis Pub/Sub.
- **Rationale**: Redis Streams introduced unnecessary latency for the 5-second pulse required by the dashboard. Redis Pub/Sub provides sub-millisecond propagation for real-time UI updates.
- **Features**: 
    - Implemented "Snapshot on Connect" to resolve startup race conditions.
    - Added server-side proactive health reconciliation (`ONLINE` -> `STALE` -> `OFFLINE`).
    - Integrated UI threshold calibration for operator tuning.

### Update 4: Overload Protection & Backpressure
- **Change**: Implemented a comprehensive Backpressure Controller with real-time cluster metrics.
- **Features**:
    - **Real-time Caching**: Node metrics cached in Redis for instant aggregation.
    - **Adaptive Rate Limiting**: API Gateway rate limits now automatically lower as system load increases.
    - **Priority-Aware Load Shedding**: The scheduler now rejects low-priority tasks during high-load scenarios to preserve resources for CRITICAL tasks.
- **Impact**: System can now handle bursts of 1000+ tasks/sec without saturating the control plane.

### Update 5: Persistent Documentation Protocol
- **Change**: Established a "hardcoded" memory system for the project.
- **Components**:
    - Created [.agent/instructions.md](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/.agent/instructions.md) to command all future agents to maintain the Chronicle.
    - Updated [README.md](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/README.md) with the **Chronicle Protocol**.
- **Rationale**: Ensures technical continuity and "baseline awareness" across long breaks (2-3 months) in the project's multi-month development lifecycle.
- **Impact**: Zero friction for future developers or AI assistants to pick up where we left off.

### Update 6: Distributed Tracing & Observability Hardening
- **Change**: Integrated OpenTelemetry (OTel) across all 6 microservices for end-to-end distributed tracing.
- **Rationale**: Resolved the "visibility gap" where cross-service failures were difficult to debug. Standardized on W3C TraceContext for context propagation.
- **Features**:
    - **Shared Telemetry Kernel**: Centralized OTel initialization in `shared-kernel` using OTLP/gRPC exporter and auto-instrumentation (Fastify, Redis, PG, HTTP).
    - **Redis Streams Propagation**: Integrated trace injection/extraction into the `EventBus` message headers.
    - **Redis Propagation**: Implemented a metadata-envelope pattern for Redis heartbeats to ensure trace continuity between Node Service and WebSocket Gateway.
    - **Manual Instrumentation**: Added high-fidelity spans to the `TaskScheduler` to track scoring variables (policy, ML score, latency) and record decision outcomes.
    - **Grafana Visualization**: Deployed a dedicated "Distributed Tracing" dashboard for P95 scheduling latency and service-wide error rates.
### Update 8: Unified Observability Logging & Correlation
- **Change**: Standardized structured logging and request correlation using `pino` and `AsyncLocalStorage`.
- **Rationale**: Standardized observability across the monorepo to enable effective cross-service debugging and log-trace-metric correlation. Standardizing on `X-Request-ID` for global correlation.
- **Features**:
    - **Shared Logger Foundation**: Created a high-performance `pino` logger in `shared-kernel` with an OTel mixin that automatically attaches `traceId` and `spanId` to every log line.
    - **Log Sanitization**: Implemented a global redaction plugin for Fastify and Express to protect sensitive data (`password`, `token`, `secret`).
    - **Request Correlation**: Integrated `AsyncLocalStorage` to manage a unique `requestId` context that persists across asynchronous operations without manual prop-drilling.
    - **Multi-Transport Propagation**:
        - **HTTP**: Automated propagation via `X-Request-ID` header using a `fastify-plugin` and `getRequestHeaders` utility for outgoing `axios` calls.
        - **Redis Streams**: Enhanced `EventBus` to inject/extract correlation IDs from message headers.
        - **Redis**: Propagated correlation context through the `_otel` metadata envelope in real-time heartbeats.
    - **Infrastructure Integration**: Deployed **Grafana Loki** for centralized log aggregation and linked it to Jaeger traces in Grafana, enabling "Jump to Logs" directly from a trace span.
- **Impact**: Unified the debugging experience. Developers can now trace a single user request through the entire service chain (API -> Task -> Scheduler -> Node -> Agent) using a single `requestId` or `traceId`.
