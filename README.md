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
   Task Service     Scheduler Service    Node Service
        │                  │                  │
        └─────────── Kafka Event Bus ─────────┘
                           │
                    Distributed Workers
                           │
                    Edge Nodes / Cloud
```

## Empirical Benchmarks

| Metric / Benchmark | Empirical Result | Source File | Last Verified |
| --- | --- | --- | --- |
| **Carbon Shift Efficiency** | 11.41% carbon reduction (4.79 kg CO2 saved across 1,000 tasks, 416 deferred) | [`data/carbon_benchmark_results.json`](data/carbon_benchmark_results.json) | 2026-07-28 |
| **Scheduling Load & Latency** | 366,387.6 RPS throughput, 0.008 ms P95 latency (2,000 tasks, 100% success rate) | [`data/load_test_results.json`](data/load_test_results.json) | 2026-07-28 |

## Tech Stack

- **Languages & Runtimes**: TypeScript (Node.js/Fastify/Express), Rust (Edge Agent), Python (ML Scheduler)
- **Frontend & Web UI**: React, Vite, Tailwind CSS
- **Messaging & Caching**: Apache Kafka (Event Streaming), Redis (Pub/Sub & Rate Limiting)
- **Database & Storage**: PostgreSQL (Prisma ORM, PgBouncer; CockroachDB compatible)
- **Infrastructure & Orchestration**: Docker, Docker Compose, Kong / Nginx API Gateway
- **Observability & Security**: Prometheus, Grafana, Jaeger (Distributed Tracing), mTLS (X.509 CA & RSA CSR; dev-mode default: bypassed via `x-node-id`), HashiCorp Vault (PKI & KV v2; dev-mode default: bypassed via `EnvSecretManager`)

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
