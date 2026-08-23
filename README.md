# Edge-Cloud Compute Orchestrator

[![Build Status](https://img.shields.io/github/actions/workflow/status/SumitMahajan11/edge-cloud-orchestrator/ci.yml?branch=main)](https://github.com/SumitMahajan11/edge-cloud-orchestrator/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-1.x-orange.svg)](https://www.rust-lang.org/)

The **Edge-Cloud Compute Orchestrator** is a production-grade distributed edge-cloud orchestration platform designed for intelligent task scheduling, real-time workload execution, and resilient system management across heterogeneous edge nodes and cloud infrastructure.

## Architecture

```
            ┌──────────────────────────┐
            │     Frontend (React)     │
            └──────────┬───────────────┘
                       │
                API Gateway (Kong/Nginx)
                       │
    ┌──────────────────┼──────────────────┐
    │                  │                  │
Task Service Scheduler Service Node Service
│ │ │
└─────────── Kafka Event Bus ─────────┘
│
Distributed Workers
│
Edge Nodes / Cloud
```

## Key Features

**Reliability & Fault Tolerance**
- Saga pattern for distributed transactions
- Transactional Outbox pattern
- Circuit breaker + retry strategies
- Dead letter queue (DLQ)

**Intelligent Scheduling**
- Multi-objective scoring (latency, CPU, cost, memory)
- ML/heuristic-based predictive scheduling
- Load-aware and cost-aware routing

**System Resilience**
- Auto-healing system
- Backpressure control
- Graceful degradation
- Recovery storm prevention

## Workflow

1. User submits task
2. API Gateway routes request
3. Task Service stores request
4. Outbox publishes event → Kafka
5. Scheduler selects optimal node
6. Node executes task (Docker container)
7. Metrics + logs collected
8. Result returned to user

## Tech Stack

- **Languages & Runtimes**: TypeScript (Node.js/Fastify/Express), Rust (Edge Agent), Python (ML Scheduler)
- **Frontend & Web UI**: React, Vite, Tailwind CSS
- **Messaging & Caching**: Apache Kafka (Event Streaming), Redis (Pub/Sub & Rate Limiting)
- **Database & Storage**: PostgreSQL (Prisma ORM, PgBouncer; CockroachDB compatible)
- **Infrastructure & Orchestration**: Docker, Docker Compose, Kong / Nginx API Gateway
- **Observability & Security**: Prometheus, Grafana, Jaeger (Distributed Tracing), mTLS (X.509 CA & RSA CSR — certificate management fully implemented and tested; server-side enforcement (`setupMTLSServer`) is scaffolded but not yet wired into the running server or its dependency installed; dev-mode default: bypassed via `x-node-id`), HashiCorp Vault (PKI & KV v2; dev-mode default: bypassed via `EnvSecretManager`)

## Testing

> Test commands (`npm vitest run`, `npm test`) must be run from inside the `edge-cloud-orchestrator` directory (the workspace root) so `vitest.config.ts` and global test utilities load correctly.

```bash
# Run unit tests
npm vitest run

# Load testing & empirical benchmarks
npx tsx scripts/system-load-benchmark.ts
npx tsx scripts/carbon-benchmark.ts
npx tsx scripts/fl-simulator.ts 5
```

## Empirical Benchmarks

| Metric / Benchmark | Empirical Result | Source File | Last Verified |
| --- | --- | --- | --- |
| **Carbon Shift Efficiency** | 11.41% carbon reduction (4.79 kg CO2 saved across 1,000 tasks, 416 deferred) | [`data/carbon_benchmark_results.json`](data/carbon_benchmark_results.json) | 2026-07-28 |
| **Scheduling Load & Latency** | 366,387.6 RPS throughput, 0.008 ms P95 latency (2,000 tasks, 100% success rate) | [`data/load_test_results.json`](data/load_test_results.json) | 2026-07-28 |

## Quickstart

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env

# Start system
docker-compose up -d

# Run application
npm run dev
```

Open `http://localhost:5173` in your browser.

## License

MIT License
