# @edgecloud/scheduling-utils

## Purpose

Advanced scheduling algorithms: gang scheduling (all-or-nothing multi-node task placement), preemption, resource reservations, bin-packing, and priority queues. Pure algorithmic utilities with no I/O — used by scheduler-service.

## Installation

```sh
pnpm add @edgecloud/scheduling-utils
```

## Exports

| Export            | Type     | Description                                  |
| ----------------- | -------- | -------------------------------------------- |
| `selectNode`      | function | Pick the best node for a task                |
| `gangSchedule`    | function | Allocate multiple nodes atomically           |
| `preempt`         | function | Evict lower-priority tasks to free resources |
| `SchedulingError` | class    | Typed scheduling failure with cause          |
| `PriorityQueue`   | class    | Min-heap priority queue                      |

## Usage

```typescript
import { selectNode, SchedulingError } from "@edgecloud/scheduling-utils";

try {
  const node = selectNode(candidateNodes, task, policy);
} catch (e) {
  if (e instanceof SchedulingError) {
    /* handle */
  }
}
```

## Build

```sh
pnpm build   # tsc → dist/
pnpm test
```
