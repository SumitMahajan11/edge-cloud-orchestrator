# Edge-Cloud Compute Orchestrator

A production-ready distributed edge computing platform with real-time task scheduling, container execution, and comprehensive monitoring.

## Quick Start

```bash
# 1. Setup environment
.\scripts\setup-env.ps1

# 2. Start edge agents
.\scripts\start-agents.bat

# 3. Start orchestrator dashboard
npm run dev

# 4. Open http://localhost:5173
```

## Architecture

```
┌─────────────────┐     HTTP      ┌─────────────────┐
│  Orchestrator   │ ◄────────────►│  Edge Agent 1   │──┐
│   Dashboard     │   /run-task   │   Port 4001     │  │
│   (React/Vite)  │   /heartbeat  └─────────────────┘  │
└─────────────────┘                                    │
        │                              ┌───────────────┼──► Docker
        │                              │               │
        │                  ┌───────────┴───┐           │
        │                  │  Edge Agent 2 │───────────┤
        │                  │   Port 4002   │           │
        │                  └───────────────┘           │
        │                                              │
        │                  ┌───────────────┐           │
        └─────────────────►│  Edge Agent 3 │───────────┘
           Webhooks        │   Port 4003   │
                           └───────────────┘
```

## Project Structure

```
edge-cloud-orchestrator/
├── docs/                    # Documentation
│   └── TESTING.md          # Testing guide
├── infrastructure/          # Deployment configs
│   ├── docker/             # Docker compose files
│   └── k8s/                # Kubernetes manifests
├── monitoring/             # Observability
│   ├── load-test.js        # k6 load testing
│   └── prometheus/         # Prometheus config
├── scripts/                # Automation scripts
│   ├── setup-env.ps1       # Environment setup
│   └── start-agents.bat    # Start edge agents
├── edge-agent/             # Edge node agent
│   ├── server.js           # Agent service
│   └── package.json        # Agent dependencies
├── containers/             # Task containers
│   ├── image-classifier/   # ML inference
│   ├── data-aggregator/    # Data processing
│   └── log-analyzer/       # Log analysis
├── src/                    # Orchestrator dashboard
│   ├── components/         # React components
│   ├── pages/              # Page components
│   ├── hooks/              # Custom hooks
│   ├── lib/                # Utilities
│   ├── types/              # TypeScript types
│   └── context/            # React context
├── package.json            # Project dependencies
├── tailwind.config.js      # Tailwind CSS config
└── tsconfig.json           # TypeScript config
```

## Features

### Core Functionality
- ✅ Real-time task scheduling (edge vs cloud)
- ✅ Docker container execution on edge nodes
- ✅ Multi-node orchestration with health monitoring
- ✅ Webhook notifications for events
- ✅ Role-based authentication (Admin/Operator/Viewer)
- ✅ Persistent data storage (IndexedDB)

### Scheduling Policies
- **Latency-Aware**: Routes to nearest low-latency node
- **Cost-Aware**: Optimizes for cost efficiency
- **Round-Robin**: Distributes evenly across nodes
- **Load-Balanced**: Considers CPU, memory, and latency

### Monitoring & Observability
- Real-time metrics dashboard
- Node health monitoring with heartbeat
- Task execution logs
- Webhook delivery tracking
- Load testing with k6

## Tech Stack

### Frontend
- React 18 + TypeScript
- Vite (build tool)
- Tailwind CSS + shadcn/ui
- Recharts (visualization)
- Framer Motion (animations)

### Backend (Edge Agents)
- Node.js + Express
- Docker CLI integration
- Systeminformation (metrics)

### Infrastructure
- Docker containers
- Optional: Kubernetes, AWS/GCP/Azure

## API Reference

### Edge Agent Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/metrics` | GET | CPU, memory, tasks |
| `/heartbeat` | GET | Node status |
| `/run-task` | POST | Execute container |
| `/tasks` | GET | List running tasks |
| `/ping` | GET | Latency test |

### Example: Run Task

```bash
curl -X POST http://localhost:4001/run-task \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task-001",
    "taskName": "Image Classification",
    "image": "edgecloud-image-classifier",
    "resources": {
      "memory": "256m",
      "cpu": "0.5"
    }
  }'
```

## Testing

See [docs/TESTING.md](docs/TESTING.md) for detailed testing guide.

Quick tests:
```bash
# Unit tests
npm test

# Load testing (requires k6)
cd monitoring
k6 run load-test.js

# Manual API test
curl http://localhost:4001/health
```

## Deployment

### Local Development
```bash
# Terminal 1: Start agents
.\scripts\start-agents.bat

# Terminal 2: Start dashboard
npm run dev
```

### Production (Docker Compose)
```bash
cd infrastructure/docker
docker-compose up -d
```

### Production (Kubernetes)
```bash
cd infrastructure/k8s
kubectl apply -f .
```

## Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@edgecloud.io | password |
| Operator | operator@edgecloud.io | password |
| Viewer | viewer@edgecloud.io | password |

## License

MIT License - See LICENSE file
