# @edgecloud/web

## What this service does

React 18 dashboard for the Edge-Cloud Compute Orchestrator. Provides real-time visibility into edge nodes, running tasks, scheduling decisions, system metrics, audit logs, and policy management. Connects to the backend API via REST and WebSocket.

## Port

| Variable | Default | Description              |
|----------|---------|--------------------------|
| PORT     | 5173    | Vite dev server          |
| —        | static  | Production: served by api-gateway |

## Environment Variables (Vite)

| Variable              | Required | Description                              |
|-----------------------|----------|------------------------------------------|
| VITE_API_URL          | no       | Backend API base URL (default: /api)     |
| VITE_WS_URL           | no       | WebSocket URL (default: /ws)             |

## Development

```sh
pnpm dev          # vite dev server with HMR
pnpm build        # tsc && vite build → dist/
pnpm test         # vitest run
pnpm preview      # preview production build
```

## Source structure

See [src/README.md](src/README.md) for the detailed source directory reference.

## Docker

The web app is built as a static bundle and served by `apps/api-gateway` (Nginx). There is no separate container for the web app in production.

```sh
pnpm build
# dist/ is then copied into the api-gateway container image
```
