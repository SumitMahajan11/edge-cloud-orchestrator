# ADR-0001: Event-Driven Architecture with Distributed Event Bus, Sagas, and Outbox Pattern

* **Status:** Accepted with known gaps
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
   - Cited: `packages/event-bus/src/event-bus.ts#L45-L65` (Kafka), `packages/event-bus/src/dead-letter-queue.ts#L74-L100` (Redis Streams), `apps/task-service/src/index.ts#L330-L336`.
   - **Verified context** — `event-bus.ts` L45-L65 (accurate):
     ```
     45: export class EventBus {
     46:   private kafka: Kafka;
     47:   private producer: Producer;
     48:   private consumers: Map<string, Consumer> = new Map();
     49:   private isConnected: boolean = false;
     50:   private dlq: DeadLetterQueue | null = null;
     51:   private config: EventBusConfig;
     52: 
     53:   constructor(config: EventBusConfig) {
     54:     this.config = config;
     55:     this.kafka = new Kafka({ clientId: config.clientId, brokers: config.brokers, ... });
     ```
   - **Verified context** — `dead-letter-queue.ts` L74-L104 (accurate, class is at L74 not L74-L100):
     ```
     74: export class DeadLetterQueue extends EventEmitter {
     75:   private prisma: PrismaClientLike;
     76:   private config: DLQConfig;
     77:   private redisClient: Redis;
     ...   // initializes Redis client for Redis Streams
     100:   this.redisClient = redisOrUrl;
     104:   this.redisClient.on("error", ...);
     ```
   - **Verified context** — `task-service/src/index.ts` L330-L336 (accurate — log says "Redis Streams" but `EventBus` receives `kafkaBrokers`):
     ```
     314:   const kafkaBrokers = env.KAFKA_BROKERS.split(",");
     316:   eventBus = new EventBus({ clientId: "task-service", brokers: kafkaBrokers, redis: redisClient });
     330:   await eventBus.connect();
     331:   await eventBus.createTopics(DEFAULT_TOPIC_CONFIG);
     332:   logger.info(`Event bus connected to Redis Streams at ${redisUrl}`);  // misleading log
     ```
   - **Conclusion:** All three citations are accurate. Line ranges are correct.

2. **Outbox Polling Latency:**
   - Cited: `packages/outbox/src/outbox-manager.ts#L51-L58`.
   - **Verified context** (accurate — `DEFAULT_OUTBOX_CONFIG` is at L51):
     ```
     51: export const DEFAULT_OUTBOX_CONFIG: OutboxConfig = {
     52:   pollingIntervalMs: 1000,
     53:   batchSize: 100,
     54:   maxAttempts: 5,
     55:   retryBaseDelayMs: 1000,
     56:   retryMaxDelayMs: 60000,
     57:   enabled: true,
     58: };
     ```
   - **Conclusion:** Citation accurate. `pollingIntervalMs: 1000` is the default; no LISTEN/NOTIFY or CDC is wired.

3. **Locking Fallback Risk in Saga Orchestrator:**
   - Cited: `packages/saga/src/saga-orchestrator.ts#L135-L137`.
   - **Verified context** (accurate — `acquireLock` starts at L130, `return true` is at L136):
     ```
     130:   private async acquireLock(sagaId: string, ttlMs: number = 30000): Promise<boolean> {
     131:     console.log(`[Orchestrator] Acquiring lock for saga ${sagaId}`);
     132:     // ...
     135:     if (!this.redis) {
     136:       return true;
     137:     } // Skip if Redis not configured
     138: 
     139:     const lockKey = `saga:lock:${sagaId}`;
     ```
   - **Corrected citation:** `#L135-L137` is accurate (was originally cited as `#L135-L137` ✅). No correction needed.

4. **Direct Publishing Bypassing Outbox:**
   - Cited: `apps/task-service/src/service.ts#L43`.
   - **Verified context** (accurate — `eventBus.publish` is at L43, preceded by the DB write at L26):
     ```
     24:   async createTask(command: CreateTaskCommand): Promise<Task> {
     25:     // Create task in database
     26:     const task = await this.repository.create(command);
     27: 
     28:     // Publish TaskCreated event
     29:     const event: TaskCreatedEvent = { ... };
     ...
     43:     await this.eventBus.publish(TOPICS.TASK_EVENTS, event);
     44: 
     45:     return task;
     46:   }
     ```
   - **Conclusion:** Citation accurate. `OutboxManager` is not used here.

5. **Duck-Typed DLQ Prisma Dependency:**
   - [`packages/event-bus/src/dead-letter-queue.ts#L57-L68`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/packages/event-bus/src/dead-letter-queue.ts#L57-L68) uses duck-typed `PrismaClientLike` for `deadLetterEvent` operations rather than generated type references.

---

## Deployed Reality (Render Free + Neon + Upstash + Vercel)

This section records the **actual** deployed architecture from codebase analysis against the architecture described above.

In the live production setup, only `apps/api` is deployed as a backend container on Render Free (using [`apps/api/Dockerfile`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/apps/api/Dockerfile) with `SECRET_BACKEND=env`), connecting to Neon PostgreSQL and Upstash Redis. The frontend is hosted on Vercel.

| Concern | Architecture Decision | Deployed Code Reality | Status |
|---------|----------------------|-----------------------|--------|
| **EventBus Startup Construction** | KafkaJS (`EventBus`) startup connection | `apps/api` does **not** construct or connect an `EventBus` during startup (`apps/api/src/initializers/services.ts`). `EventBus` is only built inside 3 admin handlers (`apps/api/src/routes/admin.ts:611`, `apps/api/src/routes/admin.ts:729`, `apps/api/src/routes/admin.ts:961`). | **Verified from code** |
| **Kafka Broker Configuration (`KAFKA_BROKERS`)** | Dedicated Kafka broker cluster | `KAFKA_BROKERS` defaults to `localhost:9092` (`apps/api/src/config/env.ts:37`). Because it is defaulted and not strictly required, the API server boots normally without a Kafka cluster configured in environment variables. | **Verified from code** |
| **Kafka Health Check (`kafka:connected`)** | Real-time Kafka broker health monitoring | The health check reads Redis key `kafka:connected` (`apps/api/src/services/health-monitor.ts:345`) and nothing in `apps/api/src` sets it (#78 tracks this). | **Verified from code** |
| **Transactional Outbox Worker** | `OutboxManager` polling PostgreSQL | `OutboxManager` is **not** initialized or started anywhere in `apps/api` (`apps/api/src/initializers/services.ts`). Outbox polling is not active in the deployed API container. | **Verified from code** |
| **Dead Letter Queue Initialization** | `DeadLetterQueue` initialized at startup | `initializeDLQ` is **not** invoked in `apps/api`. DLQ records are queried directly from PostgreSQL via Prisma for admin inspection in `apps/api/src/routes/admin.ts`. | **Verified from code** |
| **Saga Orchestrator & Recovery Loop** | `SagaOrchestrator` with Redis locking | `sagaOrchestrator.startRecovery()` is explicitly initialized at startup in `apps/api/src/initializers/services.ts:126`, registering `createTaskLifecycleSaga`. Distributed locking uses Redis when `REDIS_URL` is configured. | **Verified from code** |
| **PostgreSQL & Redis Providers** | Managed cloud infrastructure | Database and Redis connectivity rely on `DATABASE_URL` and `REDIS_URL`. Provider details (Neon and Upstash) are runtime configuration. | **Unverified** (runtime environment) |

### Manual Verification Checklist (Render Dashboard)
To verify the runtime configuration for the Render backend container, confirm the presence of the following **environment variable names** (never share or log their secret values):
- `DATABASE_URL` (Required: connection string for PostgreSQL / Neon)
- `REDIS_URL` (Optional / Recommended: connection string for Redis / Upstash)
- `JWT_SECRET` (Required: min 32 characters for token signing)
- `ENCRYPTION_KEY` (Required: min 32 characters for AES encryption)
- `SECRET_BACKEND` (Set to `env` for direct container environment variable injection)
- `KAFKA_BROKERS` (Optional: only needed if triggering on-demand admin republish endpoints)

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
