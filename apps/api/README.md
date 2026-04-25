# @edgecloud/api

## What this service does

Unified REST + GraphQL backend for the Edge-Cloud Compute Orchestrator. Handles authentication (JWT + mTLS), RBAC/ABAC authorization, node registration, task lifecycle, policy management, real-time WebSocket events, and the Prisma/PostgreSQL data layer.

## Port

| Variable | Default | Description          |
|----------|---------|----------------------|
| PORT     | 3090    | HTTP listen port     |

## Environment Variables

| Variable              | Required | Description                             |
|-----------------------|----------|-----------------------------------------|
| DATABASE_URL          | yes      | PostgreSQL connection string            |
| JWT_SECRET            | yes      | HMAC-SHA256 signing key (≥32 chars)     |
| REDIS_URL             | yes      | Redis connection URL                    |
| KAFKA_BROKERS         | no       | Comma-separated Kafka broker addresses  |
| VAULT_ADDR            | no       | HashiCorp Vault address                 |
| VAULT_TOKEN           | no       | Vault root/approle token                |
| OTEL_EXPORTER_ENDPOINT| no       | OpenTelemetry collector gRPC endpoint   |
| NODE_ENV              | no       | production / development (default: development) |

See `config/.env.example` for a complete list.

## Development

```sh
pnpm dev          # tsx watch src/index.ts (hot-reload)
pnpm build        # tsc → dist/
pnpm test         # vitest run
pnpm migrate      # prisma migrate dev
```

## Docker

```sh
docker build -t edgecloud/api .
docker run -p 3090:3090 --env-file ../../config/.env.local edgecloud/api
```

## Health Check

`GET /health` → `{ "status": "ok", "version": "1.0.0" }`

## Key Routes

| Method | Path                   | Description                   |
|--------|------------------------|-------------------------------|
| POST   | /auth/login            | JWT login                     |
| GET    | /api/nodes             | List edge nodes               |
| POST   | /api/tasks             | Submit task                   |
| GET    | /api/policies          | List scheduling policies      |
| GET    | /metrics               | Prometheus metrics scrape     |
| WS     | /ws                    | Real-time event stream        |
