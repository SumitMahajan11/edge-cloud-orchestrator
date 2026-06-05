# @edgecloud/task-service

## What this service does

Task lifecycle management microservice. Accepts task submissions, validates resources, persists tasks to the database, dispatches them to edge agents via the event bus, tracks execution status (pending → running → succeeded/failed), and handles retries with exponential backoff.

## Port

| Variable | Default | Description      |
| -------- | ------- | ---------------- |
| PORT     | 3005    | HTTP listen port |

## Environment Variables

| Variable      | Required | Description                  |
| ------------- | -------- | ---------------------------- |
| DATABASE_URL  | yes      | PostgreSQL connection string |
| REDIS_URL     | yes      | Redis connection URL         |
| KAFKA_BROKERS | no       | Kafka broker addresses       |
| NODE_ENV      | no       | production / development     |

## Development

```sh
pnpm dev          # tsx watch src/index.ts
pnpm build        # tsc → dist/
pnpm test         # vitest run
```

## Docker

```sh
docker build -t edgecloud/task-service .
docker run -p 3005:3005 --env-file ../../config/.env.local edgecloud/task-service
```

## Health Check

`GET /health` → `{ "status": "ok" }`
