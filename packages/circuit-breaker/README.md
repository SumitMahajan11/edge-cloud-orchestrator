# @edgecloud/circuit-breaker

## Purpose

Fault tolerance patterns: circuit breakers, retry with exponential backoff, bulkheads, and distributed checkpointing. Wraps any async operation with configurable failure thresholds, half-open probing, and fallback strategies.

## Installation

```sh
pnpm add @edgecloud/circuit-breaker
```

## Exports

| Export              | Type  | Description                                |
| ------------------- | ----- | ------------------------------------------ |
| `CircuitBreaker`    | class | Circuit breaker with open/half-open/closed |
| `RetryManager`      | class | Exponential backoff retry                  |
| `Bulkhead`          | class | Concurrency limiter                        |
| `CheckpointManager` | class | Distributed checkpoint store (Redis)       |

## Usage

```typescript
import { CircuitBreaker } from "@edgecloud/circuit-breaker";

const breaker = new CircuitBreaker({ threshold: 5, timeout: 30000 });
const result = await breaker.execute(() => fetchFromExternalService());
```

## Build

```sh
pnpm build   # tsc → dist/
pnpm test
```
