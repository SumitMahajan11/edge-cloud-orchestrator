# New Engineer Onboarding

Welcome. This document gets you from zero to a running local stack in under 10 minutes.

---

## 5-Minute Quickstart

```bash
# 1. Clone
git clone https://github.com/your-org/edge-cloud-orchestrator
cd edge-cloud-orchestrator

# 2. Install all dependencies (monorepo-aware)
pnpm install

# 3. Start local stack (PostgreSQL 16 + Redis 7 + all backend services)
docker compose -f docker-compose.dev.yml up -d

# 4. Wait for health (polls all services until healthy)
pnpm run verify:health

# 5. Open dashboard
# http://localhost:8080
```

### What you're running locally

| Component | Port |
|---|---|
| PostgreSQL 16 | 5432 |
| Redis 7 | 6379 |
| api | 3000 |
| task-service | 3001 |
| websocket-gateway | 3002 |
| scheduler-service | 3003 |
| node-service | 3004 |
| metrics-service | 3005 |
| React frontend (web) | 8080 |

---

## First Task: Submit a task via curl

```bash
curl -X POST http://localhost:3000/v1/tasks \
  -H "Authorization: Bearer $(cat .local/api-key)" \
  -H "Content-Type: application/json" \
  -d '{"image":"alpine:latest","command":["echo","hello world"]}'
```

Expected response:
```json
{ "taskId": "task_abc123", "status": "PENDING" }
```

Open the dashboard → Tasks page. Within 10 seconds the task should progress:
```
PENDING → SCHEDULED → RUNNING → COMPLETED
```

If it stays at `PENDING`, check the scheduler logs:
```bash
docker compose -f docker-compose.dev.yml logs scheduler-service
```

---

## Project Structure (Quick Mental Model)

```
edge-cloud-orchestrator/
├── apps/                  # 6 backend services (each fully independent, one Dockerfile)
│   ├── api/               # REST API, auth, task CRUD
│   ├── task-service/      # Task lifecycle management
│   ├── scheduler-service/ # ML-driven node placement
│   ├── node-service/      # Edge node heartbeat aggregation
│   ├── websocket-gateway/ # Real-time push to dashboard
│   └── metrics-service/   # Prometheus aggregation endpoint
├── packages/              # 16 shared libraries (built with tsc, dist/ generated)
│   ├── shared-kernel/     # Domain events, base types, env validation
│   ├── event-bus/         # Redis Streams publish/subscribe abstraction
│   ├── ml-scheduler/      # Scheduling algorithms and ML model
│   ├── circuit-breaker/   # Resilience patterns
│   ├── security/          # JWT, ABAC policy engine
│   └── ...                # (see packages/ for full list)
├── infra/
│   ├── k8s/               # Kubernetes manifests (Kustomize base + overlays)
│   │   ├── base/          # Shared Deployments, Services, HPA, PDB
│   │   ├── overlays/      # staging/ and production/ patches
│   │   └── argocd/        # ArgoCD Application manifests
│   └── experimental/      # Non-production configs (Chaos Mesh, multi-region)
├── docs/                  # Architecture, runbook, deployment, onboarding
├── tests/                 # Unit, integration, smoke, E2E, load tests
├── config/                # .env.example (template) + .env.local (local values)
└── monitoring/            # Prometheus + Grafana configs
```

**Rule:** `infra/experimental/` is never synced by ArgoCD. Don't reference it in overlays.

---

## Key Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install all dependencies (hoisted, monorepo-aware) |
| `pnpm build` | Build all services and packages |
| `pnpm test` | Run all unit tests |
| `pnpm test:integration` | Run integration tests (requires postgres + redis running) |
| `pnpm run lint` | ESLint across all packages and apps |
| `pnpm exec vitest run --workspace=vitest.workspace.ts` | Run full test suite from monorepo root |
| `pnpm --filter api start` | Start just the API service |
| `pnpm --filter web build` | Build the React frontend |
| `pnpm --filter @edgecloud/shared-kernel build` | Build a specific package |

> **Important:** Always run `vitest` from the monorepo root using `--workspace=vitest.workspace.ts`. Running it from inside a package directory picks up incorrect relative paths.

---

## Making Your First Change

**Example: Add a new scheduling policy**

1. **Create a feature branch**
   ```bash
   git checkout -b feature/scheduling-policy-xyz
   ```

2. **Add logic** to `packages/ml-scheduler/src/policies/` (new file)

3. **Add unit tests** to `packages/ml-scheduler/src/__tests__/` (new test file)

4. **Export** from `packages/ml-scheduler/src/index.ts`

5. **Wire it in** `apps/scheduler-service/src/index.ts`

6. **Test locally**
   ```bash
   pnpm --filter @edgecloud/scheduler-service start
   ```

7. **Run all tests**
   ```bash
   pnpm exec vitest run --workspace=vitest.workspace.ts
   ```

8. **Write an ADR** — create `docs/decisions/XXX-policy-xyz.md` explaining why this policy was added (what problem it solves, what alternatives were rejected)

9. **Open a PR.** CI must pass all jobs before merge.

10. **After merge:** CD pipeline auto-deploys to staging within 5 minutes.

---

## Architecture in One Paragraph

The system is an **edge compute orchestrator**: users submit container workloads via a REST API; a ML-driven scheduler places them on edge nodes based on resource availability and policy constraints; edge agents execute the containers and report heartbeats every 5 seconds; real-time status is pushed to the dashboard via WebSockets. All state lives in PostgreSQL. All coordination (events, pub/sub) goes through Redis Streams. All inter-service traffic in production is mTLS-only.

For the full diagram and scaling details, see [ARCHITECTURE.md](./ARCHITECTURE.md).
For deployment procedures, see [DEPLOYMENT.md](./DEPLOYMENT.md).
For incident response, see [RUNBOOK.md](./RUNBOOK.md).

---

## Environment Variables

The canonical list is in `config/.env.example`. Copy it to `config/.env.local` for local development:

```bash
cp config/.env.example config/.env.local
# Edit .env.local with your local values
```

**Critical variables:**

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `JWT_SECRET` | Yes | Min 32 characters; never commit this |
| `NODE_ENV` | Yes | `development`, `production`, or `test` |
| `MTLS_ENABLED` | No | Default `false` in development |

> **Never commit `.env.local` or any file containing real secrets.** The pre-commit hook will reject files matching `*.crt`, `*.pfx`, `*.pem`, `*.key`.

---

## Shared Packages Quick Reference

| Package | Import | Purpose |
|---|---|---|
| `@edgecloud/shared-kernel` | `import { DomainEvent, validateEnv } from '@edgecloud/shared-kernel'` | Base types, env validation |
| `@edgecloud/event-bus` | `import { EventBus } from '@edgecloud/event-bus'` | Redis Streams pub/sub |
| `@edgecloud/circuit-breaker` | `import { CircuitBreaker } from '@edgecloud/circuit-breaker'` | Resilience |
| `@edgecloud/security` | `import { PolicyBuilder } from '@edgecloud/security'` | ABAC policy evaluation |
| `@edgecloud/ml-scheduler` | `import { SchedulingAlgorithm } from '@edgecloud/ml-scheduler'` | Scheduling policies |

**EventBus publish signature note:** `eventBus.publish()` accepts `Omit<DomainEvent, 'eventId' | 'timestamp'>`. Do NOT pass `timestamp` — it is auto-generated internally.

---

## Getting Help

- Architecture questions → [ARCHITECTURE.md](./ARCHITECTURE.md)
- Deployment questions → [DEPLOYMENT.md](./DEPLOYMENT.md)
- Production incidents → [RUNBOOK.md](./RUNBOOK.md)
- Past decisions → `docs/decisions/` (each file is an ADR)
- Historical guides → `docs/archive/` (kept for reference, may be outdated)
