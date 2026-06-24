# Edge-Cloud Orchestrator
A system that decides which computer (cloud or edge device) should run a given task, taking into account cost, speed, and the carbon footprint of the electricity grid at that moment.
It features ML-driven task scheduling, mTLS mutual authentication, real-time observability, and a React dashboard - all structured as a pnpm monorepo.

## What's in this repo
| Part | What it does | Where |
|---|---|---|
| **API** | The brain - decides where tasks run, tracks everything, exposes REST endpoints | `apps/api` |
| **Agent** | Runs on edge devices, executes tasks, reports back metrics/heartbeats | `apps/agent` |
| **Web Dashboard** | React-based user interface to see what's happening and configure settings | `apps/web` |
| **Shared packages** | Modular libraries shared across the API, Agent, and Dashboard | `packages/` |

## Quick start (5 minutes)
You can run the entire system locally in **mock mode** without needing Docker, PostgreSQL, or Redis running:

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173` to view the React dashboard. The API runs on `http://localhost:3090`.

## Quick start with real infrastructure
1. `cp config/.env.example config/.env.local`
2. `docker compose -f infra/docker/docker-compose.yml up -d`
3. `pnpm --filter @edgecloud/api exec prisma migrate dev && pnpm dev`

For a comprehensive guide, see the [Onboarding Guide](docs/ONBOARDING.md).

## How it works
1. **Submit**: A client submits a task to the API.
2. **Schedule**: The TaskScheduler picks the best node using ML models and policy heuristics (latency, cost, node health, carbon intensity).
3. **Dispatch**: The task is sent over WebSockets to the selected Edge Agent.
4. **Execute**: The Edge Agent runs the task in a Docker sandbox and streams metrics back.
5. **Complete**: Results are saved and the dashboard updates in real time.

## Architecture
See [ARCHITECTURE.md](ARCHITECTURE.md) for the deep dive, or [docs/decisions/](docs/decisions/) for why specific technical choices were made.

## Performance
Tested against real PostgreSQL and Redis (no mocks).

| Metric | Result |
|---|---|
| Tasks scheduled | 1000/1000 (100%) |
| P50 scheduling latency | 250ms |
| P99 scheduling latency | 508ms |
| Carbon reduction (deferrable tasks) | ~26% vs naive scheduling |

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md). Good first issues are tagged `good-first-issue` on the [issues page](https://github.com/SumitMahajan11/edge-cloud-orchestrator/issues).

## License
MIT - see [LICENSE](LICENSE) for details.
