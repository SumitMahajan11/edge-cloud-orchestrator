# @edgecloud/metrics-service

## What this service does

Metrics aggregation and export microservice. Collects Prometheus metrics from all services, aggregates time-series data, exposes a `/metrics` scrape endpoint, and publishes aggregated summaries to Redis for the dashboard. Provides anomaly detection alerts for node CPU/memory spikes.

## Port

| Variable | Default | Description      |
| -------- | ------- | ---------------- |
| PORT     | 3006    | HTTP listen port |

## Environment Variables

| Variable  | Required | Description              |
| --------- | -------- | ------------------------ |
| REDIS_URL | yes      | Redis connection URL     |
| NODE_ENV  | no       | production / development |

## Development

```sh
pnpm dev          # tsx watch src/index.ts
pnpm build        # tsc → dist/
```

## Docker

```sh
docker build -t edgecloud/metrics-service .
docker run -p 3006:3006 --env-file ../../config/.env.local edgecloud/metrics-service
```

## Health Check

`GET /health` → `{ "status": "ok" }`

## Key Endpoints

`GET /metrics` — Prometheus text format scrape endpoint
