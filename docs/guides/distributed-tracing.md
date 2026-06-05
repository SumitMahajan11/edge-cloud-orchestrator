# Distributed Tracing Guide

The Edge-Cloud Orchestrator uses **OpenTelemetry (OTel)** for distributed tracing, with **Jaeger** as the primary visualization backend. This setup allows developers to track request flows across the API Gateway, Orchestrator API, internal microservices, and Edge Agents.

## 1. Architecture

- **Instrumentation**: Auto-instrumentation via `@opentelemetry/auto-instrumentations-node` combined with manual spans for business logic.
- **Propagation**:
  - Trace context is propagated via `X-Trace-ID` and `X-Request-ID` HTTP headers.
  - Redis Streams messages include `_otel` metadata for cross-process propagation.
- **Collector**: Jaeger Agent (UDP 6831).
- **Visualization**: Jaeger UI (TCP 16686).

## 2. Viewing Traces

1. Start the local infrastructure:
   ```bash
   docker-compose -f docker-compose.dev.yml up -d jaeger
   ```
2. Open the Jaeger UI: [http://localhost:16686](http://localhost:16686)
3. Select a service (e.g., `orchestrator-api`) and click "Find Traces".

## 3. Manual Instrumentation

Use the `tracer` exported from `@edgecloud/shared-kernel` to create custom spans for critical business paths.

### Standard Pattern

```typescript
import { tracer } from "@edgecloud/shared-kernel";
import { SpanStatusCode } from "@opentelemetry/api";

async function myComplexLogic() {
  await tracer.startActiveSpan("my_service:operation_name", async (span) => {
    try {
      span.setAttribute("custom.attribute", "value");

      // Your business logic here

      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

### Request Correlation

Every service automatically starts a root span for HTTP requests via the shared `fastifyLoggingPlugin` or `createExpressLoggingMiddleware`.

- The **Trace ID** is available via `getTraceId()` from `@edgecloud/shared-kernel`.
- The **Request ID** is available via `getRequestId()`.

## 4. Key Traced Components

| Component        | Span Name                      | Key Attributes                                        |
| ---------------- | ------------------------------ | ----------------------------------------------------- |
| **API Gateway**  | `nginx`                        | `http.method`, `http.url`, `request_id`               |
| **Scheduler**    | `scheduler:process_queue`      | `task.id`, `node.id`, `scheduler.throttled`           |
| **Dispatcher**   | `scheduler:dispatch_task`      | `http.url`, `task.id`, `node.id`                      |
| **Edge Agent**   | `agent:run_task`               | `task.id`, `task.image`, `node.id`                    |
| **Heartbeat**    | `orchestrator:heartbeat_check` | `monitor.stale_nodes_count`                           |
| **ML Predictor** | `ml:node_score_calculation`    | `task.id`, `ml.decision.nodeId`, `ml.fallback_reason` |

## 5. Troubleshooting

- **No traces in Jaeger**: Ensure `JAEGER_ENDPOINT` is correctly set in your environment (default is `http://jaeger:6831`).
- **Disconnected Traces**: Check that `initTelemetry()` is called at the **absolute top** of your service entry point (`index.ts`) before any other imports.
- **Missing Trace IDs**: Verify that `nginx.conf` is correctly injecting `X-Trace-ID` and `X-Request-ID`.
