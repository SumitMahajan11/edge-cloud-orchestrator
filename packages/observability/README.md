# @edgecloud/observability

## Purpose

OpenTelemetry tracing, Prometheus metrics, and structured logging for all services. Provides a single `initTelemetry()` call that wires up OTLP traces, Jaeger/Zipkin export, and Pino logging with correlation IDs.

## Installation

```sh
pnpm add @edgecloud/observability
```

## Exports

| Export            | Type     | Description                                |
| ----------------- | -------- | ------------------------------------------ |
| `initTelemetry`   | function | Bootstrap OTEL SDK for a service           |
| `createLogger`    | function | Pino logger with trace correlation         |
| `MetricsRegistry` | class    | Prometheus counter/histogram/gauge factory |

## Usage

```typescript
import { initTelemetry, createLogger } from "@edgecloud/observability";

initTelemetry({
  serviceName: "my-service",
  exporterEndpoint: process.env.OTEL_EXPORTER_ENDPOINT,
});
const logger = createLogger("my-service");
logger.info({ taskId: "..." }, "task submitted");
```

## Build

```sh
pnpm build   # tsc → dist/
pnpm test
```
