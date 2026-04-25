# @edgecloud/chaos

## Purpose

Chaos engineering engine for resilience testing. Injects controlled failures (network latency, node crashes, packet loss, CPU stress) into the system to validate fault-tolerance behavior of circuit breakers, retries, and sagas.

## Installation

```sh
pnpm add @edgecloud/chaos
```

## Exports

| Export              | Type     | Description                                  |
|---------------------|----------|----------------------------------------------|
| `ChaosEngine`       | class    | Orchestrates chaos experiments               |
| `NetworkChaos`      | class    | Latency, packet loss, partition injection    |
| `NodeChaos`         | class    | Node crash/restart simulation                |
| `ChaosExperiment`   | type     | Experiment definition with rollback          |

## Usage

```typescript
import { ChaosEngine, NetworkChaos } from '@edgecloud/chaos'

const engine = new ChaosEngine({ dryRun: false })
await engine.run({
  name: 'latency-spike',
  fault: new NetworkChaos({ latencyMs: 500, targetNode: 'edge-01' }),
  durationMs: 30_000
})
```

## Build

```sh
pnpm build   # tsc → dist/
pnpm test
```
