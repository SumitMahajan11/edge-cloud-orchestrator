# @edgecloud/saga

## Purpose

Distributed saga orchestration for multi-step operations that span multiple services (e.g., submit task → reserve resources → dispatch to agent → commit). Each step has a compensating action; if any step fails the saga rolls back via compensations.

## Installation

```sh
pnpm add @edgecloud/saga
```

## Exports

| Export             | Type     | Description                                  |
|--------------------|----------|----------------------------------------------|
| `SagaOrchestrator` | class    | Runs saga steps with automatic compensation  |
| `SagaStep`         | type     | Step definition: action + compensation       |
| `SagaContext`      | type     | Shared state passed between steps            |

## Usage

```typescript
import { SagaOrchestrator, SagaStep } from '@edgecloud/saga'

const steps: SagaStep[] = [
  { execute: reserveResources, compensate: releaseResources },
  { execute: dispatchToAgent,  compensate: cancelDispatch },
]
const saga = new SagaOrchestrator(steps)
await saga.run(context)
```

## Build

```sh
pnpm build   # tsc → dist/
pnpm test
```
