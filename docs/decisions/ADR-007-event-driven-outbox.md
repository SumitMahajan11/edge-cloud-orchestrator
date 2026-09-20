# ADR-007: Use event-driven architecture with a transactional outbox

Date: 2026-09-20
Status: Accepted

## Context

The control plane coordinates tasks, nodes, scheduling, authentication, and workflow state across multiple services. Directly calling downstream services after a database write couples request latency and availability to every consumer. It also creates a consistency gap: a process failure between the database commit and event publication can leave other services unaware of a state change.

The platform already contains a transactional outbox and event-bus abstraction. The architecture therefore needs an explicit decision describing how domain changes become events, how consumers recover, and what delivery guarantees callers should expect.

## Decision

Use an event-driven architecture for cross-service domain notifications. A service writes its domain mutation and the corresponding outbox event in the same database transaction. The outbox publisher later delivers pending events to the event bus, where independent consumers process them asynchronously.

Events must have stable names, versioned payloads, a unique event identifier, and enough tenant and correlation metadata for consumers to enforce authorization and idempotency. Consumers must persist or otherwise durably record processed event identifiers before acknowledging work. Retries must use bounded backoff, and messages that exceed the retry policy must be routed to a dead-letter queue for investigation and replay.

This decision provides **at-least-once delivery**, not exactly-once processing. A publisher or consumer may retry after a timeout, so duplicate delivery is expected and every consumer is responsible for idempotent handling. The outbox remains the source of truth for events until publication succeeds; cleanup is permitted only after the configured retention period and operational audit requirements are satisfied.

## Consequences

- Domain writes and their notifications commit atomically without a distributed transaction.
- Services are decoupled from consumer availability and can process events asynchronously.
- Failed delivery can be retried, inspected in a dead-letter queue, and replayed after remediation.
- Event identifiers and versioned payloads provide a stable contract for new consumers.

* At-least-once delivery requires idempotency in every consumer and can produce duplicates.
* Polling or background publication adds bounded event latency and operational work.
* Outbox, retry, and dead-letter data require retention, monitoring, and cleanup policies.
* Eventual consistency means a consumer may observe a domain change after the originating request completes.
