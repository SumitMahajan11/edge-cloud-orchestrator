# Edge-Cloud Orchestrator - Production Architecture

## Overview

This is a production-grade, distributed edge-cloud compute orchestrator featuring:

- **RAFT Consensus**: Distributed leader election and state replication
- **Microservices Architecture**: Stateless, horizontally scalable services
- **Event-Driven**: Kafka-based event streaming
- **Intelligent Scheduling**: ML-based multi-objective optimization
- **Distributed Database**: CockroachDB for horizontal scalability
- **Kubernetes Ready**: Full K8s manifests with auto-scaling

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Gateway (Nginx)                      │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────────┐
│ Task Service │    │ Node Service │    │ Scheduler Service│
│   (x3 pods)  │    │   (x3 pods)  │    │  (RAFT Cluster)  │
└──────────────┘    └──────────────┘    └──────────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────────┐
│   Apache     │    │ CockroachDB  │    │     Redis        │
│    Kafka     │    │  (3 nodes)   │    │   (Cache)        │
└──────────────┘    └──────────────┘    └──────────────────┘
```

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 18+
- kubectl (for Kubernetes deployment)

### Local Development

```bash
# 1. Start infrastructure services
docker-compose up -d cockroachdb-1 cockroachdb-2 cockroachdb-3 cockroachdb-init

# 2. Wait for CockroachDB to be ready, then run schema
sleep 10
psql -h localhost -p 26257 -U root -f infrastructure/cockroachdb/schema.sql

# 3. Start Kafka
docker-compose up -d zookeeper kafka-1 kafka-2 kafka-3

# 4. Install dependencies and build
npm install
npm run build

# 5. Start services
docker-compose up -d
```

### Kubernetes Deployment

```bash
# 1. Create namespace
kubectl apply -f infrastructure/kubernetes/namespace.yaml

# 2. Apply all manifests
kubectl apply -f infrastructure/kubernetes/

# 3. Verify deployment
kubectl get pods -n edgecloud
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| API Gateway | 80 | Nginx load balancer |
| Task Service | 3001 | Task lifecycle management |
| Node Service | 3002 | Edge node management |
| Scheduler Service | 3003 | RAFT-based intelligent scheduler |
| CockroachDB | 26257 | Distributed SQL database |
| Kafka | 9092 | Event streaming platform |

## API Endpoints

### Tasks
- `POST /tasks` - Create a new task
- `GET /tasks` - List tasks
- `GET /tasks/:id` - Get task details
- `POST /tasks/:id/cancel` - Cancel a task
- `GET /tasks/stats` - Get task statistics

### Nodes
- `POST /nodes` - Register a new node
- `GET /nodes` - List nodes
- `GET /nodes/:id` - Get node details
- `POST /nodes/:id/heartbeat` - Send node heartbeat

### Scheduling
- `GET /schedule/metrics` - Scheduler metrics
- `POST /schedule/:taskId` - Trigger manual scheduling

## Configuration

Environment variables for each service:

```env
# Database
DATABASE_HOST=cockroachdb-1
DATABASE_PORT=26257
DATABASE_NAME=edgecloud
DATABASE_USER=root
DATABASE_PASSWORD=

# Kafka
KAFKA_BROKERS=kafka-1:9092,kafka-2:9092,kafka-3:9092

# RAFT (Scheduler only)
NODE_ID=scheduler-1
RAFT_PORT=7001
RAFT_PEERS=scheduler-2:host2:7002,scheduler-3:host3:7003
```

## Scaling

### Horizontal Pod Autoscaling

The Task Service and Node Service are configured with HPA:

```yaml
minReplicas: 3
maxReplicas: 10
targetCPUUtilizationPercentage: 70
```

### Database Scaling

CockroachDB can be scaled by adding more nodes:

```bash
docker-compose up -d cockroachdb-4
```

## Monitoring

### Health Checks

Each service exposes a `/health` endpoint for liveness and readiness probes.

### Metrics

Scheduler service exposes RAFT metrics at `/metrics`:
- Current term
- Leader status
- Log replication status
- Election statistics

## Migration from v1

To migrate from the monolithic v1 architecture:

```bash
# 1. Export data from PostgreSQL
pg_dump -h localhost -U postgres edgecloud > backup.sql

# 2. Set up CockroachDB (see Quick Start)

# 3. Run migration script
psql -h localhost -p 26257 -U root -f migration/postgres-to-crdb.sql
```

## Development

### Adding a New Service

1. Create directory in `apps/`
2. Add `package.json` with dependencies
3. Implement service logic
4. Add Dockerfile
5. Update `docker-compose.yml`
6. Add Kubernetes manifests

### Running Tests

```bash
npm test
```

## License

MIT
