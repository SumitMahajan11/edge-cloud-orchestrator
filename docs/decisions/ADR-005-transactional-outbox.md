# ADR-005: Use transactional outbox pattern for reliable event publishing
Date: 2026-06-11
Status: Accepted

## Context
The API must publish domain events (task created, node enrolled, etc.) to the event bus. Naive approach: write to DB then publish event. Problem: if the process dies between write and publish, the event is lost. Two-phase commit is too heavy for this use case.

## Decision
Transactional outbox pattern — events written to OutboxEvent table in the same transaction as the domain entity. A separate poller reads and publishes uncommitted outbox entries.

## Consequences
+ Guaranteed at-least-once event delivery even if process crashes mid-transaction
+ No distributed transaction required
+ Simple to implement with existing Prisma + Postgres stack
- Polling adds latency (configurable, default 1s)
- OutboxEvent table grows without TTL cleanup (mitigated by TTL job)
- Duplicate events possible (consumers must be idempotent)
