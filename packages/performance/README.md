# @edgecloud/performance

## Purpose

Adaptive performance optimizations: Redis caching with LRU eviction, PostgreSQL connection pooling with health monitoring, query result memoization, and backpressure-aware request queuing.

## Installation

```sh
pnpm add @edgecloud/performance
```

## Exports

| Export                 | Type  | Description                               |
| ---------------------- | ----- | ----------------------------------------- |
| `PerformanceOptimizer` | class | Orchestrates caching + pooling strategies |
| `CacheManager`         | class | Redis-backed LRU cache with TTL           |
| `ConnectionPool`       | class | Pg connection pool with adaptive sizing   |

## Usage

```typescript
import { CacheManager } from "@edgecloud/performance";

const cache = new CacheManager({ redis: redisClient, ttl: 60 });
const nodes = await cache.getOrSet("nodes:active", () => fetchActiveNodes());
```

## Build

```sh
pnpm build   # tsc → dist/
pnpm test
```
