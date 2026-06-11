# ADR-002: Use Redlock algorithm for distributed scheduling locks
Date: 2026-06-11
Status: Accepted

## Context
Multiple API instances could attempt to schedule the same task simultaneously in a distributed deployment. Single Redis SETNX is not safe under Redis failover — a new primary might not have the lock state.

## Decision
Redlock algorithm (5 Redis nodes, 5000ms TTL, finally-release pattern) as specified in the Redis Redlock paper.

## Consequences
+ Safe under Redis Sentinel failover
+ Prevents duplicate task assignment under concurrent schedulers
+ Industry-standard approach used by Bull, BullMQ, and others
- Requires 5 Redis nodes for full correctness guarantee (dev uses 1)
- 5000ms lock TTL means delayed tasks can hold locks for up to 5s
- Clock drift between Redis nodes is a theoretical correctness concern
