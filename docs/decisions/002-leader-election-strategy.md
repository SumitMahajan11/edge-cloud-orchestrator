# ADR-002: Leader Election Strategy Consolidation

**Status**: Accepted  
**Date**: 2026-04-14  
**Authors**: Engineering Team

---

## Context

The Edge-Cloud Orchestrator previously maintained two parallel distributed consensus/locking mechanisms:

1. **RAFT (via `raft-consensus`)**: A custom implementation of the RAFT consensus algorithm used for state replication and leader election in the scheduler.
2. **Redlock (via Redis)**: Used for distributed mutexes and simple locking in various microservices.

Maintaining both introduced significant architectural complexity, increased the risk of split-brain scenarios (where different mechanisms elect different leaders), and duplicated infrastructure dependencies.

## Decision

We have decided to **standardize on Redlock** for leader election across the entire platform and **demote RAFT to experimental status**.

### Comparison

| Feature             | RAFT (Custom)                                | Redlock (Redis)                          |
| ------------------- | -------------------------------------------- | ---------------------------------------- |
| **Consistency**     | Strong (Linearizable)                        | Probabilistic (Strong enough for leases) |
| **Complexity**      | High (Custom network protocol, log handling) | Low (Leverages existing Redis infra)     |
| **Infrastructure**  | Requires dedicated cluster/ports             | Reuses core Redis dependency             |
| **Performance**     | High latency for consensus                   | Low latency for locks                    |
| **Maintainability** | Low (Internal custom code)                   | High (Standard industry pattern)         |

### Why Redlock for THIS system?

1. **Infrastructure Convergence**: Redis is already a core dependency for our event queue, circuit breakers, and state synchronization. Standardizing on it reduces our operational footprint.
2. **Pragmatism over Purity**: While RAFT provides stronger theoretical consistency guarantees, the Edge-Cloud Orchestrator's leader election is primarily a **lease-based** mechanism for the Task Scheduler. If two nodes were briefly both "leaders" due to a partition, the database's ACID properties (via Prisma/PostgreSQL) act as the final guardrail.
3. **Developer Velocity**: The `LeaderElection` service in `shared-kernel` is ~150 lines of code, whereas the RAFT implementation was a multi-package dependency with significantly more moving parts.

## Consequences

- **Experimental Move**: `packages/raft-consensus` has been moved to `packages/experimental/raft-consensus`.
- **API Simplification**: Services no longer need to manage node lists, consensus ports, or log replication. They simply "acquire leadership" via the `LeaderElection` class.
- **Failover Behavior**: Leader failover is now governed by the Redis lock TTL (default 15s). During a leader crash, scheduling will pause for at most 1 attempt period before a new leader takes over.

## Verification

The new strategy was verified by:

1. Refactoring `scheduler-service` to use `LeaderElection`.
2. Verifying that only one instance registers as the leader in Prometheus (`is_leader` gauge).
3. Simulating leader crash and verifying that another instance picks up the lease within the TTL window.
