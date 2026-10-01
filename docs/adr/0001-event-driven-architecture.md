# ADR-0001: Event-Driven Architecture with Distributed Event Bus, Sagas, and Outbox Pattern

* **Status:** Accepted
* **Deciders:** Edge-Cloud Orchestrator Architecture Team
* **Date:** 2026-10-01
* **Technical Story:** Issue #34 (Event-Driven Architecture Specification)

---

## Context and Problem Statement

The Edge-Cloud Orchestrator is a distributed system responsible for managing edge nodes, scheduling compute workloads, monitoring node health, tracking SLA compliance, and dispatching tasks across heterogeneous edge and cloud environments ([`docs/ARCHITECTURE.md`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/docs/ARCHITECTURE.md)).

The system requires coordinating complex multi-step state machines across distinct microservices and modules, including:
1. **Task Lifecycle Management:** Task submission, scheduling, node assignment, execution, timeout monitoring, and completion/cancellation ([`apps/api/src/sagas/task-lifecycle-saga.ts#L8-L15`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/apps/api/src/sagas/task-lifecycle-saga.ts#L8-L15), [`apps/task-service/src/service.ts#L24-L120`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/apps/task-service/src/service.ts#L24-L120)).
2. **Node Health & Auto-Healing:** Node registration, heartbeat monitoring, eviction, and automatic recovery ([`apps/api/src/services/auto-healer.ts`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/apps/api/src/services/auto-healer.ts), [`apps/node-service/src/service.ts`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/apps/node-service/src/service.ts)).
3. **Telemetry & Real-Time Metrics:** Streaming raw metrics, aggregation, and threshold alerting ([`packages/event-bus/src/event-bus.ts#L264-L286`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/event-bus/src/event-bus.ts#L264-L286)).
4. **Reliable Distributed Consistency:** Ensuring that if any step fails during long-running distributed actions, compensation actions execute deterministically without orphaned reservations or dirty state ([`packages/saga/src/saga-orchestrator.ts#L39-L52`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/saga/src/saga-orchestrator.ts#L39-L52)).

Direct synchronous point-to-point HTTP communication creates tight temporal coupling, cascade failures, and potential state inconsistencies if a participant crashes during an operation.

---

## Decision Drivers

* **Decoupling & Temporal Independence:** Microservices (API, Task Service, Node Service, Scheduler, Agents) must process events asynchronously without blocking callers.
* **Fault Tolerance & Reliability:** No lost events on server crashes (at-least-once delivery guarantees).
* **Distributed Consistency without 2PC:** Long-running, multi-service transactions must support automated compensation and step-by-step state recovery without blocking database locks.
* **Observability & Traceability:** Distributed tracing and correlation IDs must seamlessly propagate across messaging boundaries.
* **Poison-Pill Handling:** Failed messages must not halt stream processing and must route to a Dead Letter Queue with exponential retry policies.

---

## Considered Options

1. **Option 1: Synchronous Request/Response (REST / gRPC only)**
   - All inter-service communications execute via direct HTTP/gRPC calls.
2. **Option 2: Pure Message Broker Streaming (Kafka / NATS alone without Sagas or Outbox)**
   - Asynchronous messaging over Kafka or NATS where services write to DB and immediately publish events to the broker.
3. **Option 3: Direct Database Polling**
   - Services coordinate by updating PostgreSQL tables and running background polling loops (e.g., `SELECT * FROM tasks WHERE status = 'PENDING' FOR UPDATE`).
4. **Option 4: Hybrid Event-Driven Architecture (Distributed Event Bus + Transactional Outbox + Saga Orchestration with Redis/Kafka) [CHOSEN]**
   - Combines a structured domain event bus, transactional outbox for atomic publishing, distributed sagas with compensating actions, and dead-letter queues.

---

## Decision Outcome

Chosen option: **Option 4 — Hybrid Event-Driven Architecture**, using:

1. **Distributed Event Bus (`@edgecloud/event-bus`):**
   - KafkaJS-based pub/sub for high-throughput, partitioned event streaming ([`packages/event-bus/src/event-bus.ts#L45-L65`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/event-bus/src/event-bus.ts#L45-L65)).
   - Standardized topic schemas: `tasks.commands`, `tasks.events`, `nodes.commands`, `nodes.events`, `metrics.raw`, `metrics.aggregated`, `scheduler.decisions`, `system.alerts` ([`packages/event-bus/src/event-bus.ts#L265-L275`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/event-bus/src/event-bus.ts#L265-L275), [`packages/shared-kernel/src/interfaces/event-bus.ts#L16-L26`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/shared-kernel/src/interfaces/event-bus.ts#L16-L26)).
   - Built-in OpenTelemetry span creation and context propagation across message headers (`x-request-id`, `traceparent`, `correlation-id`) ([`packages/event-bus/src/event-bus.ts#L118-L129`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/event-bus/src/event-bus.ts#L118-L129), [`packages/event-bus/src/event-bus.ts#L163-L184`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/event-bus/src/event-bus.ts#L163-L184)).
   - Dead Letter Queue (`DeadLetterQueue`) backed by Redis Streams and PostgreSQL outbox persistence with stepped backoff retry (`1s`, `5s`, `30s`) ([`packages/event-bus/src/dead-letter-queue.ts#L41-L51`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/event-bus/src/dead-letter-queue.ts#L41-L51), [`packages/event-bus/src/dead-letter-queue.ts#L74-L105`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/event-bus/src/dead-letter-queue.ts#L74-L105)).

2. **Saga Orchestrator (`@edgecloud/saga`):**
   - Orchestrated Saga execution with explicit `execute` and `compensate` step definitions ([`packages/saga/src/saga-orchestrator.ts#L39-L52`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/saga/src/saga-orchestrator.ts#L39-L52)).
   - Durable persistence of saga instances and step history via Prisma PostgreSQL store ([`packages/saga/src/saga-orchestrator.ts#L62-L90`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/saga/src/saga-orchestrator.ts#L62-L90)).
   - Distributed locking with Redis and auto-renewing heartbeat tokens (`saga:lock:${sagaId}`) to prevent concurrent execution across cluster instances ([`packages/saga/src/saga-orchestrator.ts#L130-L195`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/saga/src/saga-orchestrator.ts#L130-L195)).
   - Background recovery loop (`startRecovery()`) to resume or compensate stalled/interrupted sagas ([`packages/saga/src/saga-orchestrator.ts#L112-L127`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/saga/src/saga-orchestrator.ts#L112-L127), [`apps/api/src/initializers/services.ts#L126`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/apps/api/src/initializers/services.ts#L126)).
   - Prometheus metrics for observability (`active_sagas_total`, `saga_compensations_total`) ([`packages/saga/src/saga-orchestrator.ts#L8-L17`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/saga/src/saga-orchestrator.ts#L8-L17)).

3. **Transactional Outbox (`@edgecloud/outbox`):**
   - Guarantees atomicity between local database transactions and event publishing ([`packages/outbox/src/outbox-manager.ts#L87-L105`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/outbox/src/outbox-manager.ts#L87-L105)).
   - Persistent outbox queue tracking event state (`PENDING`, `PROCESSING`, `PUBLISHED`, `FAILED`) and publishing to Kafka with exponential backoff retry ([`packages/outbox/src/outbox-manager.ts#L5-L14`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/outbox/src/outbox-manager.ts#L5-L14)).

4. **Circuit Breakers & Redis Sync (`@edgecloud/circuit-breaker`):**
   - Fails fast during downstream failure cascades, with state synchronization across cluster nodes via Redis pub/sub ([`packages/circuit-breaker/src/circuit-breaker.ts`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/circuit-breaker/src/circuit-breaker.ts), [`packages/circuit-breaker/src/redis-sync.ts#L22-L75`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/circuit-breaker/src/redis-sync.ts#L22-L75)).

---

## Pros and Cons of the Options

### Option 1: Synchronous Request/Response (REST / gRPC)

* Good, because it is simple to implement and understand for basic CRUD.
* Good, because it requires fewer infrastructure dependencies (no brokers or queues).
* Bad, because services become tightly coupled in availability (if the node agent or scheduler is slow/down, API requests block and fail).
* Bad, because multi-service coordination lacks automated compensation rollbacks upon downstream step timeouts.
* Bad, because it cannot efficiently handle fan-out event broadcasting (e.g., telemetry metrics to multiple consumers).

### Option 2: Message Broker Streaming Alone (Kafka / NATS without Sagas/Outbox)

* Good, because it provides asynchronous high-throughput event distribution.
* Bad, because naive direct publishing suffers from the dual-write problem: if the database commit succeeds but broker publish fails (or process crashes in between), state diverges permanently.
* Bad, because choreography across multiple event streams becomes uncoordinated and difficult to monitor without a centralized orchestrator and step log.

### Option 3: Direct Database Polling

* Good, because it uses existing PostgreSQL infrastructure without additional broker services.
* Bad, because polling intervals introduce unwanted latency (e.g., 500ms–2000ms delay before scheduling).
* Bad, because database polling (`SELECT ... FOR UPDATE`) creates high disk I/O, table lock contention, and high CPU load under multi-worker scale.

### Option 4: Hybrid Event-Driven Architecture (Chosen)

* Good, because the Transactional Outbox eliminates the dual-write dilemma by storing events atomically in PostgreSQL transactions.
* Good, because Sagas provide deterministic multi-step forward progress and compensation rollback with persistent state in PostgreSQL.
* Good, because OpenTelemetry trace contexts seamlessly flow across event boundaries for end-to-end distributed tracing.
* Good, because failed messages route to DLQ with automated backoff retry, isolating poison pills from healthy workloads.
* Bad, because it introduces additional infrastructure dependencies (PostgreSQL + Kafka + Redis).
* Bad, because eventual consistency requires idempotency handling across all event consumers.

---

## Real Consequences & Codebase Observations

### Positive Consequences
* **High Availability & Resilience:** API endpoints remain responsive under high load or temporary node agent downtime ([`apps/task-service/src/service.ts`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/apps/task-service/src/service.ts)).
* **Resilient Distributed Transactions:** The `TaskLifecycleSaga` safely manages resource reservation, execution, heartbeat monitoring, and compensation rollbacks ([`apps/api/src/sagas/task-lifecycle-saga.ts#L86-L250`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/apps/api/src/sagas/task-lifecycle-saga.ts#L86-L250)).
* **End-to-End Tracing:** Trace IDs are extracted and injected across Kafka and async execution contexts ([`packages/event-bus/src/event-bus.ts#L163-L184`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/event-bus/src/event-bus.ts#L163-L184)).

### Real Downsides & Technical Debt Found in the Code
1. **Dual Broker Ambiguity / Dual-Stack Messaging:**
   - The primary `EventBus` class in [`packages/event-bus/src/event-bus.ts#L45-L65`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/event-bus/src/event-bus.ts#L45-L65) uses `kafkajs` (Kafka), whereas [`packages/event-bus/src/dead-letter-queue.ts#L74-L100`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/event-bus/src/dead-letter-queue.ts#L74-L100) and legacy ADR 002 ([`docs/decisions/002-redis-streams-event-bus.md#L34`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/docs/decisions/002-redis-streams-event-bus.md#L34)) use Redis Streams. In `apps/task-service/src/index.ts#L330-L336`, log messages refer to "Redis Streams" while passing `kafkaBrokers` to `EventBus`.
2. **Outbox Polling Latency:**
   - [`packages/outbox/src/outbox-manager.ts#L51-L58`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/outbox/src/outbox-manager.ts#L51-L58) relies on periodic timer polling (`pollingIntervalMs: 1000`) rather than PostgreSQL `LISTEN`/`NOTIFY` or Change Data Capture (CDC / Debezium), adding up to 1 second latency to outbox delivery.
3. **Locking Fallback Risk in Saga Orchestrator:**
   - In [`packages/saga/src/saga-orchestrator.ts#L135-L137`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/saga/src/saga-orchestrator.ts#L135-L137), if Redis is omitted or disconnected, `acquireLock` silently returns `true`. In a multi-replica deployment without Redis, concurrent instances could attempt to execute or recover the same saga instance concurrently.
4. **Direct Publishing Bypassing Outbox:**
   - In [`apps/task-service/src/service.ts#L43`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/apps/task-service/src/service.ts#L43), `TaskService.createTask` writes directly to PostgreSQL and then immediately calls `this.eventBus.publish()`, bypassing the `OutboxManager`. A process crash between database commit and `eventBus.publish` could result in an un-emitted event.
5. **Duck-Typed DLQ Prisma Dependency:**
   - [`packages/event-bus/src/dead-letter-queue.ts#L57-L68`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/event-bus/src/dead-letter-queue.ts#L57-L68) uses duck-typed `PrismaClientLike` for `deadLetterEvent` operations rather than generated type references.

---

## Unverified Assumptions & Boundary Areas

* **CDC / Debezium Integration:** `unverified`. No active Debezium or Kafka Connect configurations were found in the current repository codebase.
* **NATS JetStream Production Deployment:** `unverified`. While NATS is referenced in architectural diagrams and discussions, all active implementations in the codebase use KafkaJS and Redis Streams.
* **Production Redis Cluster Failover Latency:** `unverified` under multi-region WAN latency scenarios.

---

## References & Citations

* **Event Bus Implementation:** [`packages/event-bus/src/event-bus.ts`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/event-bus/src/event-bus.ts)
* **Dead Letter Queue Implementation:** [`packages/event-bus/src/dead-letter-queue.ts`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/event-bus/src/dead-letter-queue.ts)
* **Saga Orchestrator Engine:** [`packages/saga/src/saga-orchestrator.ts`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/saga/src/saga-orchestrator.ts)
* **Task Lifecycle Saga Definition:** [`apps/api/src/sagas/task-lifecycle-saga.ts`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/apps/api/src/sagas/task-lifecycle-saga.ts)
* **Transactional Outbox Engine:** [`packages/outbox/src/outbox-manager.ts`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/outbox/src/outbox-manager.ts)
* **Shared Event Kernel & Interfaces:** [`packages/shared-kernel/src/interfaces/event-bus.ts`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/shared-kernel/src/interfaces/event-bus.ts)
* **Integration & E2E Tests:** [`tests/integration/saga-flow.test.ts`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/tests/integration/saga-flow.test.ts), [`tests/e2e/scheduling-flow.test.ts`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/tests/e2e/scheduling-flow.test.ts)
