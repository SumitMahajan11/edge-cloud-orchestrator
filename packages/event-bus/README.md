# @edgecloud/event-bus

## Purpose

Kafka-backed event bus with dead-letter queue (DLQ), schema validation via Avro, and at-least-once delivery guarantees. Provides a typed `EventBus` abstraction over KafkaJS.

## Installation

```sh
pnpm add @edgecloud/event-bus
```

## Exports

| Export            | Type  | Description                             |
| ----------------- | ----- | --------------------------------------- |
| `EventBus`        | class | Kafka producer/consumer wrapper         |
| `DeadLetterQueue` | class | DLQ with retry and poison-pill handling |
| `EventSchema`     | type  | Avro schema descriptor                  |

## Usage

```typescript
import { EventBus } from "@edgecloud/event-bus";

const bus = new EventBus({ brokers: ["localhost:9092"] });
await bus.publish("tasks.submitted", { taskId: "...", nodeId: "..." });
await bus.subscribe("tasks.submitted", async (event) => {
  /* ... */
});
```

## Build

```sh
pnpm build   # tsc → dist/
pnpm test
```
