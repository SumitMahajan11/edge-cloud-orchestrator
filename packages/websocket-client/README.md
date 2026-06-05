# @edgecloud/websocket-client

## Purpose

Resilient browser/Node.js WebSocket client with automatic reconnection, exponential backoff, SSE fallback, and typed message subscriptions. Used by the web dashboard to maintain a real-time connection to `websocket-gateway`.

## Installation

```sh
pnpm add @edgecloud/websocket-client
```

## Exports

| Export                | Type  | Description                                   |
| --------------------- | ----- | --------------------------------------------- |
| `WebSocketClient`     | class | Auto-reconnecting WS client with SSE fallback |
| `SubscriptionManager` | class | Typed channel subscriptions with filtering    |
| `ConnectionState`     | enum  | CONNECTING / OPEN / RECONNECTING / CLOSED     |

## Usage

```typescript
import { WebSocketClient } from "@edgecloud/websocket-client";

const client = new WebSocketClient({
  url: "ws://localhost:3002/ws",
  token: jwtToken,
});
client.subscribe("nodes", (event) => setNodes(event.data));
client.subscribe("tasks", (event) => setTasks(event.data));
await client.connect();
```

## Build

```sh
pnpm build   # tsc → dist/
```
