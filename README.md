# Edge-Cloud Orchestrator

A system that decides which computer (cloud or edge device) should run a given task, taking into account cost, speed, and the carbon footprint of the electricity grid at that moment.

It features ML-driven task scheduling, mTLS mutual authentication, real-time observability, and a React dashboard — all structured as a pnpm monorepo.

## What's in this repo

| Part | What it does | Where |
|---|---|---|
| **API** | The brain — decides where tasks run, tracks everything, exposes REST endpoints | `apps/api` |
| **Agent** | Runs on edge devices, executes tasks, reports back metrics/heartbeats | `apps/agent` |
| **Web Dashboard** | React-based user interface to see what's happening and configure settings | `apps/web` |
| **Shared packages** | Modular libraries shared across the API, Agent, and Dashboard | `packages/` |

## Quick start (5 minutes)

You can run the entire system locally in **mock mode** without needing Docker, PostgreSQL, or Redis running:

```bash
# 1. Install dependencies
pnpm install

# 2. Run the monorepo in mock mode (uses in-memory database and Redis mocks)
pnpm dev
```

Open `http://localhost:5173` to view the React dashboard. The API runs on `http://localhost:3090`.

## Quick start with real infrastructure

If you want to run with actual PostgreSQL and Redis containers:

1. **Copy the environment template**:
   ```bash
   cp config/.env.example config/.env.local
   ```
2. **Start the database and cache containers**:
   ```bash
   docker compose -f infra/docker/docker-compose.yml up -d
   ```
3. **Run database migrations and start the development server**:
   ```bash
   pnpm --filter @edgecloud/api exec prisma migrate dev
   pnpm dev
   ```

For a comprehensive guide, see the [Onboarding Guide](docs/ONBOARDING.md).

## How it works (the 60-second version)

Here is how a task flows through the system:
1. **Submit**: A client submits a task to the API.
2. **Schedule**: The API's `TaskScheduler` analyzes available edge nodes and cloud clusters. It uses a combination of machine learning models (to predict success) and policy heuristics (considering network latency, execution cost, node health, and the current carbon intensity of the local power grid) to select the best node.
3. **Dispatch**: The task assignment is sent over WebSockets to the selected Edge Agent.
4. **Execute**: The Edge Agent executes the task inside a sandbox (Docker container) and streams logs/metrics back.
5. **Complete**: Once execution completes, the results are saved, and the state updates on the Web Dashboard in real time.

## Want to understand the architecture?

See [ARCHITECTURE.md](ARCHITECTURE.md) for the deep dive, or [docs/decisions/](docs/decisions/) for why specific technical choices were made.

## Performance

Tested against both mock and real infrastructure.

**Real infrastructure (PostgreSQL + Redis, no mocks):**
| Metric | Result |
|---|---|
| Tasks scheduled | 1000/1000 (100%) |
| P50 scheduling latency | 250ms |
| P99 scheduling latency | 508ms |
| Average latency | 261ms |

**Mock environment (single-process, for reference):**
| Metric | Result |
|---|---|
| P50 latency | 93ms |
| Throughput | 41.3 tasks/sec |
| Node capacity | 10,000 nodes, 30MB memory |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Good first issues are tagged `good-first-issue` on the [issues page](https://github.com/SumitMahajan11/edge-cloud-orchestrator/issues).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
