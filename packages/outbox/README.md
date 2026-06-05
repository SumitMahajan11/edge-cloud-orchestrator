# @edgecloud/outbox

## Purpose

Transactional Outbox pattern for reliable event publishing. Writes domain events to an outbox table in the same DB transaction as the business operation, then a background relay publishes them to Kafka — guaranteeing exactly-once semantics without distributed transactions.

## Installation

```sh
pnpm add @edgecloud/outbox
```

## Exports

| Export          | Type  | Description                            |
| --------------- | ----- | -------------------------------------- |
| `OutboxManager` | class | Write events to outbox, run relay loop |
| `OutboxEvent`   | type  | Outbox record shape                    |
| `OutboxRelay`   | class | Background process: outbox → Kafka     |

## Usage

```typescript
import { OutboxManager } from "@edgecloud/outbox";

// In a Prisma transaction:
const outbox = new OutboxManager(prisma, eventBus);
await outbox.write(tx, { topic: "tasks.submitted", payload: { taskId } });

// Start relay (once per process):
await outbox.startRelay();
```

## Build

```sh
pnpm build   # tsc → dist/
pnpm test
```
