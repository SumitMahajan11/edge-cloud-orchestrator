# @edgecloud/websocket-gateway

## What this service does

Real-time WebSocket broadcast gateway. Subscribes to Kafka topics for node events, task status changes, metrics, and policy decisions, then broadcasts them to connected dashboard clients. Supports room-based subscriptions (per-node, per-task) and handles reconnect/backpressure automatically.

## Port

| Variable | Default | Description              |
|----------|---------|--------------------------|
| PORT     | 3002    | WebSocket listen port    |

## Environment Variables

| Variable       | Required | Description                        |
|----------------|----------|------------------------------------|
| REDIS_URL      | yes      | Redis connection URL (pub/sub)     |
| KAFKA_BROKERS  | no       | Kafka broker addresses             |
| JWT_SECRET     | yes      | JWT secret for WS auth             |
| NODE_ENV       | no       | production / development           |

## Development

```sh
pnpm dev          # tsx watch src/index.ts
pnpm build        # tsc → dist/
```

## Docker

```sh
docker build -t edgecloud/websocket-gateway .
docker run -p 3002:3002 --env-file ../../config/.env.local edgecloud/websocket-gateway
```

## Health Check

`GET /health` → `{ "status": "ok", "connections": 42 }`

## WebSocket Protocol

Connect: `ws://localhost:3002/ws?token=<JWT>`

Subscribe: `{ "type": "subscribe", "channel": "nodes" | "tasks" | "metrics" }`
