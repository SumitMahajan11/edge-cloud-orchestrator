# @edgecloud/analytics

## Purpose

Stream processing and telemetry analytics for the orchestrator. Consumes real-time event streams from Kafka, computes aggregations (throughput, latency percentiles, error rates), and emits summaries to Redis and the metrics-service.

## Installation

```sh
pnpm add @edgecloud/analytics
```

## Exports

| Export              | Type  | Description                                   |
| ------------------- | ----- | --------------------------------------------- |
| `StreamProcessor`   | class | Windowed stream aggregation over Kafka topics |
| `TelemetrySink`     | class | Write aggregated metrics to Redis             |
| `AggregationWindow` | type  | Tumbling/sliding window configuration         |

## Usage

```typescript
import { StreamProcessor } from "@edgecloud/analytics";

const processor = new StreamProcessor({
  brokers: ["localhost:9092"],
  windowMs: 60_000,
});
processor.on("aggregate", (summary) =>
  redis.publish("analytics", JSON.stringify(summary)),
);
await processor.start(["tasks.completed", "nodes.heartbeat"]);
```

## Build

```sh
pnpm build   # tsc → dist/
pnpm test
```
