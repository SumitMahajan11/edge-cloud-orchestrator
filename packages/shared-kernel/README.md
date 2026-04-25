# @edgecloud/shared-kernel

## Purpose

Core domain types, domain events, value objects, and shared utilities used by every service and package in the monorepo. This is the single source of truth for `EdgeNode`, `Task`, `DomainEvent`, and all cross-cutting concerns.

## Installation

```sh
pnpm add @edgecloud/shared-kernel
```

## Exports

| Export              | Type      | Description                                 |
|---------------------|-----------|---------------------------------------------|
| `EdgeNode`          | type      | Edge node domain model                      |
| `Task`              | type      | Task domain model                           |
| `TaskStatus`        | enum      | Task lifecycle states                       |
| `DomainEvent`       | interface | Base domain event interface                 |
| `NodeStatus`        | enum      | Node health states                          |
| `ResourceUsage`     | type      | CPU/memory/GPU usage snapshot               |
| `createLogger`      | function  | Pino structured logger factory              |

## Usage

```typescript
import { EdgeNode, Task, TaskStatus, createLogger } from '@edgecloud/shared-kernel'

const logger = createLogger('my-service')
const task: Task = { id: '...', status: TaskStatus.PENDING, ... }
```

## Build

```sh
pnpm build   # tsc → dist/
pnpm test    # vitest run
```
