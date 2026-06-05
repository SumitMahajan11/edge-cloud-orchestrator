# @edgecloud/api-gateway

## What this service does

Nginx reverse proxy and TLS termination layer. Routes all external traffic to internal services, terminates mTLS, enforces rate limiting at the network level, and serves the compiled React dashboard (`apps/web/dist/`) as static assets.

## Port

| Variable | Default | Description               |
| -------- | ------- | ------------------------- |
| —        | 80      | HTTP (redirects to HTTPS) |
| —        | 443     | HTTPS / mTLS              |

## Upstream services routed

| Path prefix   | Upstream service       |
| ------------- | ---------------------- |
| `/api/`       | api:3090               |
| `/ws`         | websocket-gateway:3002 |
| `/scheduler/` | scheduler-service:3003 |
| `/nodes/`     | node-service:3004      |
| `/tasks/`     | task-service:3005      |
| `/metrics/`   | metrics-service:3006   |
| `/` (static)  | apps/web/dist/         |

## Configuration

Edit `nginx.conf` to change upstream addresses or TLS certificate paths.

TLS certificates are expected at:

- `/etc/nginx/certs/server.crt`
- `/etc/nginx/certs/server.key`
- `/etc/nginx/certs/ca.crt` (for mTLS client verification)

## Docker

```sh
docker build -t edgecloud/api-gateway .
docker run -p 80:80 -p 443:443 edgecloud/api-gateway
```
