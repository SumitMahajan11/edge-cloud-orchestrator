# ADR 002 — Use Redis Streams as Event Bus, not Kafka

**Date:** 2026-04-25  
**Status:** Accepted  
**Category:** Messaging

## Context

Edge-Cloud Orchestrator requires asynchronous event coordination for:
- `task.created` → Scheduler picks up task → `task.scheduled`
- `node.registered` → Load balancer updates → `node.ready`
- `task.completed` → Metrics aggregation → Cost calculation
- `alert.triggered` → Notification service → Webhook delivery

Two primary options were evaluated:

### Apache Kafka
- Industry-standard distributed event streaming platform
- High throughput (millions of events/sec)
- Strong durability guarantees (disk-based persistence)
- Complex operational model (ZooKeeper/KRaft, broker elections, partition management)

### Redis Streams
- Lightweight event streaming built into Redis
- Consumer groups with offset tracking
- Exactly-once semantics with proper acknowledgment
- Co-located with existing Redis cache infrastructure

## Decision

**We use Redis Streams as the event bus.**

### Rationale

1. **Operational Simplicity**
   - Consumers already depend on Redis for caching and distributed locks
   - No additional infrastructure (Kafka cluster, ZooKeeper/KRaft quorum)
   - Single Redis deployment serves multiple purposes (cache, locks, streams)

2. **Sufficient Throughput for Current Scale**
   - Current event rate: ~500 tasks/sec = ~2,000 events/sec (with derived events)
   - Redis Streams handles 100k+ events/sec on a single instance
   - Headroom of 50x before needing to reconsider

3. **Lower Latency**
   - In-memory processing (vs. Kafka's disk-based commit log)
   - Sub-millisecond event delivery
   - Critical for real-time task scheduling decisions

4. **Built-in Consumer Groups**
   - Automatic partitioning across consumer instances
   - Offset tracking for exactly-once processing
   - Pending Entry List (PEL) for unacknowledged message recovery

## Consequences

### Positive
- ✅ **Operational Simplicity** — No ZooKeeper, no broker elections, no partition rebalancing
- ✅ **Lower Latency** — Same process/container as cache, in-memory processing
- ✅ **Reduced Infrastructure** — One Redis deployment vs. separate Kafka cluster
- ✅ **Faster Development** — Simpler API, easier local development (single Redis container)

### Negative
- ⚠️ **Throughput Ceiling** — Not suitable if event rate exceeds 10k events/sec (then Kafka needed)
- ⚠️ **Single Point of Failure** — Single Redis instance is SPOF (mitigated with Redis Sentinel)
- ⚠️ **Limited Retention** — Memory-based storage (mitigated with MAXLEN to cap stream size)
- ⚠️ **Smaller Ecosystem** — Fewer third-party integrations vs. Kafka Connect

## Mitigation Strategies

1. **High Availability**
   - Deploy Redis Sentinel for automatic failover
   - Consider Redis Cluster if horizontal scaling needed

2. **Durability**
   - Enable Redis AOF (Append-Only File) with `appendfsync everysec`
   - Regular RDB snapshots for backup

3. **Retention Management**
   - Use `XTRIM` with MAXLEN to prevent unbounded memory growth
   - Archive old events to PostgreSQL for long-term storage

4. **Scaling Beyond 10k events/sec**
   - Shard streams by topic or region
   - Migrate to Kafka if throughput demands increase
   - Use Kafka Streams API for complex event processing

## Implementation Details

### Stream Naming Convention
```
tasks.commands      # Task lifecycle events
tasks.events        # Task state changes
nodes.commands      # Node management events
nodes.events        # Node status updates
metrics.raw         # Raw metric ingestion
metrics.aggregated  # Aggregated metrics
scheduler.decisions # Scheduling decisions
system.alerts       # System alerts
```

### Consumer Group Pattern
```typescript
// Each service has its own consumer group
await redis.xgroup('CREATE', 'tasks.commands', 'scheduler-group', '0', 'MKSTREAM');
await redis.xgroup('CREATE', 'tasks.commands', 'metrics-group', '0', 'MKSTREAM');
```

### Exactly-Once Processing
```typescript
const [id, messages] = await redis.xreadgroup('GROUP', group, consumer, 'BLOCK', 5000, 'STREAMS', stream, '>');
// Process message
await handler(message);
// Acknowledge after successful processing
await redis.xack(stream, group, id);
```

## Revisit Triggers

This decision should be revisited when:
- Event throughput consistently exceeds 10,000 events/sec
- Need for complex event processing (windowing, joins, aggregations)
- Multi-region event replication required
- Kafka Connect integrations needed (database CDC, S3 sinks)

## Alternatives Considered

- **RabbitMQ** — More complex routing, but heavier operational model
- **NATS** — Simpler than Kafka, but less mature consumer group support
- **AWS SNS/SQS** — Vendor lock-in, not suitable for hybrid cloud deployment

## References

- Redis Streams Documentation: https://redis.io/docs/data-types/streams/
- Redis Streams vs Kafka: https://redis.com/blog/redis-streams-vs-kafka/
- Consumer Groups Tutorial: https://redis.io/docs/manual/data-types/data-types-tutorial/#stream-consumer-groups
