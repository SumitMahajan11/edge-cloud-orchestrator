# @edgecloud/node-service

## What this service does

Edge node registry and health microservice. Maintains the authoritative list of registered edge nodes, tracks their resource availability (CPU, memory, GPU), heartbeat status, and exposes a REST API for node registration, deregistration, and health queries.

## Port

| Variable | Default | Description         |
|----------|---------|---------------------|
| PORT     | 3004    | HTTP listen port    |

## Environment Variables

| Variable     | Required | Description                        |
|--------------|----------|------------------------------------|
| DATABASE_URL | yes      | PostgreSQL connection string       |
| REDIS_URL    | yes      | Redis connection URL               |
| KAFKA_BROKERS| no       | Kafka broker addresses             |
| NODE_ENV     | no       | production / development           |

## Development

```sh
pnpm dev          # tsx watch src/index.ts
pnpm build        # tsc → dist/
```

## Docker

```sh
docker build -t edgecloud/node-service .
docker run -p 3004:3004 --env-file ../../config/.env.local edgecloud/node-service
```

## Health Check

`GET /health` → `{ "status": "ok" }`
