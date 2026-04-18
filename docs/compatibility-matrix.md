# API Compatibility Matrix

This document outlines the versioning strategy and compatibility guarantees between the Edge-Cloud Orchestrator Gateway and its consumers (Edge Agents, CLI, Dashboard).

## Versioning Strategy

We use **URL-based versioning** combined with **Header-based negotiation**.

- **Base URL**: `/v1/...`
- **Negotiation Header**: `X-API-Version`

### Supported Versions

| Version | Status | Introduced | Deprecation | Sunset |
|:---|:---|:---|:---|:---|
| `v1` | **Active** | 2026-04-14 | - | - |

## Version Negotiation

Clients can specify the desired version in two ways:

1.  **URL Path**: `GET /v1/tasks`
2.  **Header**: `X-API-Version: v1`

**Rules**:
- If both are provided, they **must match**.
- If neither is provided, the API defaults to the latest stable version (`v1`).
- Requesting an unsupported version returns `400 Bad Request`.

## Deprecation Policy

When a version or endpoint is deprecated, we provide a **6-month transition window** before removal (Sunset).

### Deprecation Headers

Every response from a deprecated endpoint includes:

- `Deprecation`: Date/Timestamp or `true`.
- `Sunset`: Date/Timestamp when the endpoint will be removed.
- `Link`: A rel="deprecation" link to migration guides.

### Example

```http
HTTP/1.1 200 OK
Deprecation: 2026-04-14
Sunset: 2026-10-14
Link: <https://docs.edgecloud.com/api/v2/stats>; rel="deprecation"
```

## Contract Integrity

The single source of truth for the API contract is `packages/shared-kernel/src/api-contracts/`. Both the Gateway and Edge Agents must import from this package to ensure schema alignment.

```typescript
import { v1Contracts } from '@edgecloud/shared-kernel';

// Use v1Contracts.CreateTaskV1Schema for validation
```
