# Edge-Cloud Compute Orchestrator

> A **production-grade distributed edge-cloud orchestration platform** for intelligent task scheduling, real-time execution, and resilient system management.

---

## 🚀 GSD Implementation

This project follows **GitHub Standard Development (GSD)** practices for consistent, high-quality code delivery.

---

## 📜 Project Protocol

**Mandatory for all Developers and AI Agents:**

This project utilizes a **Continuous Evolution Tracking** system. To ensure long-term maintainability over the multi-month development cycle:

1.  **Update the Chronicle**: Every technical update, architectural shift, or fix **must** be recorded in [CHRONICLE.md](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/CHRONICLE.md) before marking a task as complete.
2.  **Rationale-First**: Always document the *why* behind design decisions (e.g., choosing Redis over Kafka for specific flows).
3.  **Baseline Awareness**: Before starting work, review the latest entries in `CHRONICLE.md` to synchronize with the current project state.

---

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

##  Testing

```bash
# Unit tests
npm test

# Load testing
k6 run tests/load-test.js
```

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
