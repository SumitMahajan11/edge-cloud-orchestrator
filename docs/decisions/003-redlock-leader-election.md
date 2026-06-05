# ADR 003 — Use Redlock (Redis-based) for Scheduler Leader Election, not Raft

**Date:** 2026-04-25  
**Status:** Accepted  
**Category:** Distributed Consensus

## Context

The Scheduler service runs 3 replicas for high availability. However, only **one scheduler instance** should make task placement decisions at any given time to prevent:

- **Split-brain** — Multiple schedulers assigning the same task to different nodes
- **Over-scheduling** — Tasks exceeding node capacity due to duplicate decisions
- **Inconsistent state** — Conflicting scheduling decisions

Two primary approaches were evaluated:

### Raft Consensus

- Formal consensus algorithm with strong correctness guarantees
- Leader election via multi-round voting
- Log replication for state machine consistency
- Implemented in etcd, Consul, CockroachDB

### Redlock (Redis Distributed Lock)

- Distributed locking algorithm using Redis SET commands
- Leader holds exclusive lock with TTL
- Automatic leader timeout if leader crashes
- Simpler than Raft but weaker guarantees

## Decision

**We use Redlock (Redis-based distributed lock) for scheduler leader election.**

### Rationale

1. **Simplicity Over Formal Correctness**
   - Redlock implementation: ~50 lines of code (Redis SET with NX + TTL)
   - Raft implementation: ~1000+ lines (state machine, log replication, voting)
   - Scheduler role doesn't require Raft's strong guarantees

2. **Sufficient for Scheduler's Non-Critical Role**
   - If leadership is lost, scheduling is merely **delayed** (not incorrect)
   - New leader can acquire lock and resume scheduling within ~100ms
   - No data loss or corruption if split-brain occurs briefly

3. **Reuses Existing Redis Infrastructure**
   - Redis already deployed for event bus (Streams) and caching
   - No additional dependencies (vs. etcd/Consul for Raft)
   - Operational team already familiar with Redis

4. **Faster Leadership Acquisition**
   - Redlock: ~100ms (single Redis SET command)
   - Raft: ~500ms-2s (multiple election rounds, majority vote)
   - Faster failover = less scheduling downtime

## Consequences

### Positive

- ✅ **Operational Simplicity** — No state machine, no log replication, no vote counting
- ✅ **Faster Leadership Acquisition** — ~100ms vs. Raft's multi-round election
- ✅ **Fewer Dependencies** — Leverages existing Redis infrastructure
- ✅ **Easier Debugging** — Lock state visible via Redis CLI (`GET scheduler:leader`)

### Negative

- ⚠️ **Weaker Guarantees** — Potential split-brain under extreme network partition (Redis unreachable from some nodes)
- ⚠️ **Single Point of Failure** — Requires Redis Sentinel for true HA (single Redis instance is SPOF)
- ⚠️ **Clock Dependency** — Lock TTL assumes reasonably synchronized clocks (mitigated with short TTL + retry)
- ⚠️ **No Log Replication** — Leader state not replicated (acceptable for stateless scheduler)

## Mitigation Strategies

1. **High Availability for Redis**
   - Deploy Redis Sentinel (3 sentinel nodes + 2 Redis replicas)
   - Automatic failover if Redis primary crashes
   - Client libraries auto-reconnect to new primary

2. **Lock Safety**
   - Use short TTL (5-10 seconds) to prevent stale locks
   - Leader must renew lock before TTL expires (heartbeat)
   - Fuzzy clocks tolerated (lock safety doesn't require perfect synchronization)

3. **Split-Brain Tolerance**
   - Scheduler decisions are **idempotent** (duplicate scheduling is caught by task state checks)
   - Database unique constraints prevent double-assignment
   - Brief split-brain (few seconds) has minimal impact

4. **Monitoring**
   - Alert if lock changes hands more than 3 times in 10 minutes (flapping)
   - Track leader tenure duration (should be hours, not seconds)
   - Log leadership transitions for audit trail

## Implementation

### Leader Election

```typescript
const LOCK_KEY = "scheduler:leader";
const LOCK_TTL = 10000; // 10 seconds

async function acquireLeadership(): Promise<boolean> {
  const result = await redis.set(LOCK_KEY, instanceId, "NX", "PX", LOCK_TTL);
  return result === "OK";
}

async function renewLeadership(): Promise<boolean> {
  // Lua script to ensure atomic check-and-renew
  const script = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('PEXPIRE', KEYS[1], ARGV[2])
    else
      return 0
    end
  `;
  return (await redis.eval(script, 1, LOCK_KEY, instanceId, LOCK_TTL)) === 1;
}
```

### Leader Heartbeat

```typescript
// Renew lock every 3 seconds (3x safety margin before 10s TTL)
setInterval(async () => {
  const renewed = await renewLeadership();
  if (!renewed) {
    logger.warn("Lost leadership, stopping scheduling loop");
    stopScheduling();
  }
}, 3000);
```

### Fallback: Standy Mode

```typescript
// Non-leader schedulers monitor lock and wait
async function standbyLoop() {
  while (!(await acquireLeadership())) {
    logger.info("Not leader, waiting...");
    await sleep(1000);
  }
  logger.info("Acquired leadership, starting scheduling loop");
  startScheduling();
}
```

## Upgrade Path

If network partitions prove problematic or stronger guarantees are needed:

1. **Short-term**: Migrate to Redlock with Redis Cluster (better partition tolerance)
2. **Medium-term**: Implement Raft in `packages/experimental/raft` (already scaffolded)
3. **Long-term**: Replace with etcd/Consul if Raft becomes production-critical

## Revisit Triggers

This decision should be revisited when:

- Split-brain events cause data corruption (not just delays)
- Scheduler state becomes stateful (requires log replication)
- Network partitions occur frequently in deployment environment
- Regulatory requirements demand formal consensus guarantees

## Alternatives Considered

- **etcd** — Production-grade Raft implementation, but additional infrastructure
- **Consul** — Service discovery + Raft, but heavier operational model
- **ZooKeeper** — Mature, but complex and declining in popularity
- **Custom Raft** — Educational, but high implementation/maintenance cost

## References

- Redlock Algorithm: https://redis.io/docs/reference/patterns/distributed-locks/
- Redlock Criticism: https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html
- Redis Distributed Locks: https://redis.com/blog/distributed-locks-redis-redlock/
- Raft Consensus: https://raft.github.io/
