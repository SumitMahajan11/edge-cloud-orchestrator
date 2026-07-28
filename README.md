# Edge-Cloud Compute Orchestrator

> A **production-grade distributed edge-cloud orchestration platform** for intelligent task scheduling, real-time execution, and resilient system management.

---

## 🚀 GSD Implementation

This project follows **GitHub Standard Development (GSD)** practices for consistent, high-quality code delivery.

### Quick Start

```bash
# Setup GSD workflow
pnpm gsd:setup

# Run quality checks
pnpm gsd:check

# Auto-fix issues
pnpm gsd:fix
```

### Development Workflow

1. **Pre-commit**: Automatic linting, formatting, and type checking
2. **CI/CD**: Comprehensive quality gates and security checks
3. **Code Review**: Required for all changes to main branches

### Quality Standards

- ✅ **Linting**: ESLint with TypeScript support
- ✅ **Formatting**: Prettier for consistent style
- ✅ **Type Safety**: Strict TypeScript configuration
- ✅ **Testing**: 80%+ code coverage required
- ✅ **Security**: Automated dependency auditing

---

## Overview

The **Edge-Cloud Compute Orchestrator** is a highly scalable distributed system designed to manage compute workloads across **edge nodes and cloud environments**.

It enables:

* Intelligent task scheduling
* Real-time execution on distributed nodes
* Fault-tolerant orchestration
* Observability and monitoring

---

##  Problem Statement

Modern applications require:

* Low latency 
* Cost efficiency 
* High availability 

Traditional cloud-only systems fail to:

* Handle edge workloads efficiently
* Optimize latency-sensitive tasks
* Recover gracefully from failures

This project solves these challenges using a **distributed, event-driven architecture**.

---

##  Key Features

### Core System

* Distributed microservices architecture
* Kafka-based event-driven communication
* Real-time task scheduling (Edge vs Cloud)
* Multi-node orchestration

---

### Reliability & Fault Tolerance

*  Saga Pattern (distributed transactions)
*  Transactional Outbox Pattern
*  Circuit Breaker + Retry strategies
*  Dead Letter Queue (DLQ)

---

###  Intelligent Scheduling

*  Multi-objective scoring (latency, CPU, cost, memory)
*  Predictive scheduling (ML/heuristic-based)
*  Load-aware and cost-aware routing

---

###  System Resilience

*  Auto-healing system
*  Backpressure control
*  Graceful degradation
*  Recovery storm prevention

---

###  Observability

*  Prometheus (metrics)
*  Grafana (dashboards)
*  Jaeger (distributed tracing)
*  Correlation IDs for tracking

---

###  Security

*  mTLS authentication
*  Vault integration
*  Role-based access control

---

##  Architecture

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

---

##  Workflow

1. User submits task
2. API Gateway routes request
3. Task Service stores request
4. Outbox publishes event → Kafka
5. Scheduler selects optimal node
6. Node executes task (Docker container)
7. Metrics + logs collected
8. Result returned to user

---

##  Tech Stack

###  Frontend

* React + TypeScript
* Vite
* Tailwind CSS

---

###  Backend

* Node.js (Fastify/Express)
* Kafka (event streaming)
* Redis (cache + rate limiting)
* CockroachDB (distributed SQL)

---

###  Infrastructure

* Docker
* Kubernetes (Helm)
* Nginx / Kong API Gateway

---

###  Observability

* Prometheus
* Grafana
* Jaeger

---

##  Getting Started

###  Setup

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env

# Start system
docker-compose up -d
```

---

### Run Application

```bash
npm run dev
```

 Open:

```
http://localhost:5173
```

---

## 🧪 Testing

> **Note**: Test commands (`npx vitest run`, `npm test`) must be executed from inside the `edge-cloud-orchestrator` directory (the workspace root) so that `vitest.config.ts` with global test utilities (`describe`, `it`, `expect`, `vi`) is correctly loaded.

```bash
# Run unit tests
npx vitest run

# Load testing & empirical benchmarks
npx tsx scripts/system-load-benchmark.ts
npx tsx scripts/carbon-benchmark.ts
npx tsx scripts/fl-simulator.ts 5
```

---

## 📊 Empirical Benchmarks & Performance Metrics

All performance metrics in this repository are verified against empirical dataset runs and reproducible benchmark scripts:

| Metric Category | Empirical Benchmark Result | Verification Script | Output Artifact |
|---|---|---|---|
| **Model Training** | **0.0444 MAE**, **93.4% Accuracy** (1,000 dataset samples) | `packages/ml-scheduler/src/training/train_model.py` | `models/model_metadata.json` |
| **Federated Learning** | **0.0121 Global MAE**, **100% Convergence** (5 rounds, 5 nodes) | `scripts/fl-simulator.ts` | `data/fl_simulation_results.json` |
| **Carbon Shift Efficiency** | **11.41% Carbon Reduction** (4.79 kg CO2 saved across 1,000 tasks) | `scripts/carbon-benchmark.ts` | `data/carbon_benchmark_results.json` |
| **Scheduling Load & Latency** | **>340,000 decisions/sec**, **0.008ms P95 latency** (100% success) | `scripts/system-load-benchmark.ts` | `data/load_test_results.json` |

---

##  Project Structure

```
edge-cloud-orchestrator/
├── src/                # Frontend
├── backend/            # Backend services
├── packages/           # Shared modules
├── infrastructure/     # Deployment configs
├── docs/               # Documentation
└── docker-compose.yml
```

---

##  Why This Project is Unique

*  Combines **edge computing + distributed systems**
*  Implements **real production patterns (Saga, Outbox)**
*  Includes **intelligent scheduling logic**
*  Designed for **fault tolerance & scalability**
*  Full **observability stack**

---

##  Use Cases

* Edge AI workloads
* IoT data processing
* Distributed compute platforms
* Real-time analytics systems

---

##  License

MIT License

---

##  Author

**Sumit Mahajan**

---

##  Final Note

This project demonstrates:

> **Advanced distributed systems design, real-world architecture patterns, and production-grade engineering practices.**
