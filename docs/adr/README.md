# Architecture Decision Records (ADRs)

This directory maintains the Architecture Decision Records (ADRs) for the Edge-Cloud Orchestrator project using the [MADR (Markdown Architectural Decision Records)](https://adr.github.io/madr/) standard format.

## Active Architecture Decision Records

| Number | Title | Status | Date | Decision Summary |
|---|---|---|---|---|
| [0001](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/docs/adr/0001-event-driven-architecture.md) | [Event-Driven Architecture with Distributed Event Bus, Sagas, and Outbox Pattern](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/docs/adr/0001-event-driven-architecture.md) | `Accepted` | 2026-10-01 | Adopt hybrid event-driven architecture using KafkaJS/Redis Streams event bus, Saga orchestrator for distributed transactions, and transactional outbox. |

---

## Architectural Decisions Index & Related Records

Historical and component-specific decision documents are located in [`docs/decisions/`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/docs/decisions):

| Decision Record | Topic / Category | Status | Summary |
|---|---|---|---|
| [`ADR-001`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/docs/decisions/ADR-001-tensorflow-js-not-python.md) | ML Engine | `Accepted` | TensorFlow.js for in-process node scoring and inference over separate Python microservices |
| [`ADR-002`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/docs/decisions/ADR-002-redlock-distributed-locking.md) | Concurrency | `Accepted` | Redlock algorithm for distributed coordination and mutual exclusion |
| [`ADR-003`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/docs/decisions/ADR-003-fastify-not-express.md) | Web Framework | `Accepted` | Fastify for high throughput and low overhead HTTP handling |
| [`ADR-004`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/docs/decisions/ADR-004-rust-edge-agent.md) | Edge Runtime | `Accepted` | Rust-based edge daemon for lightweight resource usage and native hardware access |
| [`ADR-005`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/docs/decisions/ADR-005-transactional-outbox.md) | Messaging | `Accepted` | Transactional outbox table to ensure atomic database writes and event publishing |
| [`ADR-006`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/docs/decisions/ADR-006-abac-not-rbac.md) | Authorization | `Accepted` | Attribute-Based Access Control (ABAC) for multi-tenant resource access control |
| [`001`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/docs/decisions/001-postgresql-primary-database.md) | Database | `Accepted` | PostgreSQL as primary ACID transactional store |
| [`002`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/docs/decisions/002-redis-streams-event-bus.md) | Messaging | `Accepted` | Redis Streams for low-latency event bus and state sync |
| [`003`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/docs/decisions/003-redlock-leader-election.md) | Coordination | `Accepted` | Redlock leader election strategy for scheduler instances |
| [`004`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/docs/decisions/004-kustomize-argocd-deployment.md) | GitOps | `Accepted` | Declarative GitOps deployment with Kustomize and ArgoCD |
| [`005`](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/docs/decisions/005-nginx-api-gateway.md) | Ingress | `Accepted` | Nginx reverse proxy and API gateway for SSL termination and routing |

---

## Guidelines for Authoring ADRs

1. Follow the **MADR template** structure:
   - **Title**: `ADR-XXXX: Title`
   - **Status**: `Proposed`, `Accepted`, `Rejected`, `Deprecated`, or `Superseded`
   - **Context and Problem Statement**: Requirements, forces, constraints
   - **Decision Drivers**: Core architectural goals
   - **Considered Options**: Evaluated alternatives with pros/cons
   - **Decision Outcome**: Selected option with concrete justifications
   - **Consequences**: Positive effects, negative consequences, real code compromises, and technical debt
   - **References & Citations**: Direct source code links
2. Ground every architectural claim in actual codebase files and line numbers.
3. Explicitly flag any non-verified or unconfirmed assumptions as `unverified`.
