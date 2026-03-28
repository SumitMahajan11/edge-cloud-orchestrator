# Folder Structure Reorganization Plan

## Current Structure (Problems)

```
edge-cloud-orchestrator/
├── backend/              # Mixed control plane + some data plane
│   └── src/
│       ├── routes/       # API routes (control plane)
│       ├── services/     # Mixed concerns
│       └── plugins/      # Fastify plugins
├── edge-agent/           # Data plane only (good)
├── src/                  # Frontend (should be frontend/)
└── ...
```

**Problems:**
1. `backend/` mixes control plane API with data plane concerns
2. `src/` is ambiguous (frontend code)
3. No clear separation between control plane services
4. Shared code duplicated between backend and edge-agent

## New Structure

```
edge-cloud-orchestrator/
│
├── control-plane/                    # Control Plane (NEW)
│   ├── cmd/
│   │   └── api/                     # Entry point
│   │       └── main.ts
│   │
│   ├── internal/                    # Private code
│   │   ├── api/                     # API layer
│   │   │   ├── server.ts            # Fastify server setup
│   │   │   ├── routes/              # Route definitions
│   │   │   │   ├── tasks.ts
│   │   │   │   ├── nodes.ts
│   │   │   │   └── auth.ts
│   │   │   └── middleware/
│   │   │       ├── auth.ts
│   │   │       ├── rate-limit.ts
│   │   │       └── cors.ts
│   │   │
│   │   ├── scheduler/               # Scheduler service
│   │   │   ├── scheduler.ts         # Main scheduler
│   │   │   ├── queue/               # Queue implementations
│   │   │   │   ├── interface.ts
│   │   │   │   ├── redis.ts
│   │   │   │   └── memory.ts
│   │   │   └── policies/            # Scheduling policies
│   │   │       ├── latency.ts
│   │   │       ├── cost.ts
│   │   │       └── load.ts
│   │   │
│   │   ├── policy/                  # Policy engine
│   │   │   ├── engine.ts
│   │   │   ├── constraints.ts
│   │   │   └── cost/
│   │   │       ├── optimizer.ts
│   │   │       └── models.ts
│   │   │
│   │   ├── registry/                # Node registry
│   │   │   ├── registry.ts
│   │   │   ├── health.ts
│   │   │   └── monitor.ts
│   │   │
│   │   ├── state/                   # State machine
│   │   │   ├── machine.ts
│   │   │   ├── transitions.ts
│   │   │   └── store.ts
│   │   │
│   │   ├── database/                # Database layer
│   │   │   ├── prisma/
│   │   │   │   └── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── repositories/
│   │   │       ├── task.ts
│   │   │       ├── node.ts
│   │   │       └── execution.ts
│   │   │
│   │   └── observability/           # Observability
│   │       ├── metrics.ts
│   │       ├── tracing.ts
│   │       └── logging.ts
│   │
│   ├── pkg/                         # Public packages
│   │   └── api/                     # Public API types
│   │       └── v1/
│   │           ├── tasks.ts
│   │           └── nodes.ts
│   │
│   ├── proto/                       # gRPC definitions
│   │   ├── control_plane.proto
│   │   └── data_plane.proto
│   │
│   ├── config/
│   │   └── default.yaml
│   │
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── data-plane/                      # Data Plane (NEW)
│   ├── cmd/
│   │   └── agent/
│   │       └── main.ts
│   │
│   ├── internal/
│   │   ├── agent/                   # Agent core
│   │   │   ├── agent.ts             # Main agent loop
│   │   │   ├── config.ts
│   │   │   └── state.ts
│   │   │
│   │   ├── grpc/                    # gRPC client
│   │   │   ├── client.ts
│   │   │   └── stream.ts
│   │   │
│   │   ├── executor/                # Task execution
│   │   │   ├── executor.ts
│   │   │   ├── docker.ts
│   │   │   ├── runner.ts
│   │   │   └── logs.ts
│   │   │
│   │   ├── metrics/                 # Metrics collection
│   │   │   ├── collector.ts
│   │   │   ├── system.ts
│   │   │   └── reporter.ts
│   │   │
│   │   ├── runtime/                 # Container runtime
│   │   │   ├── docker.ts
│   │   │   └── container.ts
│   │   │
│   │   └── storage/                 # Local storage
│   │       ├── sqlite.ts
│   │       └── cache.ts
│   │
│   ├── pkg/
│   │   └── types/
│   │       └── agent.ts
│   │
│   ├── proto/                       # (symlink to control-plane/proto)
│   │
│   ├── config/
│   │   └── default.yaml
│   │
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── shared/                          # Shared Code (NEW)
│   ├── pkg/
│   │   ├── types/                   # Shared types
│   │   │   ├── task.ts
│   │   │   ├── node.ts
│   │   │   └── common.ts
│   │   │
│   │   ├── constants/               # Shared constants
│   │   │   └── index.ts
│   │   │
│   │   └── utils/                   # Shared utilities
│   │       ├── crypto.ts
│   │       ├── time.ts
│   │       └── validation.ts
│   │
│   ├── proto/                       # (symlink)
│   │
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                        # Frontend (RENAMED from src/)
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── types/
│   ├── package.json
│   └── vite.config.ts
│
├── runtime/                         # Container Images
│   ├── image-classifier/
│   ├── data-aggregator/
│   └── log-analyzer/
│
├── infrastructure/                  # Deployment
│   ├── docker/
│   ├── kubernetes/
│   └── terraform/
│
├── scripts/                         # Automation
│   ├── setup.sh
│   └── deploy.sh
│
├── docs/                            # Documentation
│   ├── ARCHITECTURE.md
│   ├── CONTROL_DATA_PLANE.md
│   └── API.md
│
├── Makefile                         # Build automation
├── docker-compose.yml               # Local development
└── README.md
```

## Migration Steps

### Step 1: Create New Structure

```bash
# Create new directories
mkdir -p control-plane/{cmd/api,internal/{api,scheduler,policy,registry,state,database,observability},pkg/api/v1,proto,config}
mkdir -p data-plane/{cmd/agent,internal/{agent,grpc,executor,metrics,runtime,storage},pkg/types,config}
mkdir -p shared/pkg/{types,constants,utils}
mv src frontend
```

### Step 2: Move Backend Code

```bash
# Move API routes to control-plane
mv backend/src/routes/* control-plane/internal/api/routes/
mv backend/src/plugins/* control-plane/internal/api/middleware/

# Move services to appropriate locations
mv backend/src/services/task-scheduler.ts control-plane/internal/scheduler/
mv backend/src/services/cost-optimizer.ts control-plane/internal/policy/cost/
mv backend/src/services/certificate-manager.ts control-plane/internal/auth/
mv backend/src/services/heartbeat-monitor.ts control-plane/internal/registry/
mv backend/src/services/websocket-manager.ts control-plane/internal/api/

# Move database
mv backend/src/database/* control-plane/internal/database/
mv backend/prisma control-plane/internal/database/

# Move types
mv backend/src/types/* shared/pkg/types/
mv backend/src/schemas/* shared/pkg/validation/
```

### Step 3: Move Edge Agent Code

```bash
# Move edge agent to data-plane
mv edge-agent/server.js data-plane/internal/agent/agent.ts
mv edge-agent/lib/* data-plane/internal/

# Create proper structure
mkdir -p data-plane/internal/{grpc,executor,metrics,runtime,storage}
```

### Step 4: Update Imports

```typescript
// BEFORE (old structure)
import { TaskScheduler } from '../services/task-scheduler'
import { Task } from '@prisma/client'

// AFTER (new structure)
import { TaskScheduler } from '@/scheduler/scheduler'
import { Task } from '@/shared/types/task'
```

### Step 5: Update Build Configuration

```json
// control-plane/tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["internal/*"],
      "@shared/*": ["../shared/pkg/*"]
    }
  }
}
```

## Benefits of New Structure

### 1. Clear Separation

| Before | After |
|--------|-------|
| `backend/src/services/` (mixed) | `control-plane/internal/scheduler/` (clear) |
| `backend/src/routes/` | `control-plane/internal/api/routes/` |
| `edge-agent/` | `data-plane/internal/agent/` |

### 2. Better Code Organization

```
Before: 15+ files in backend/src/services/
After:  Clear service boundaries with dedicated folders
```

### 3. Independent Deployment

```bash
# Deploy control plane only
docker build -t orchestrator-control-plane ./control-plane

# Deploy data plane only
docker build -t orchestrator-data-plane ./data-plane

# Deploy specific service
docker build -t orchestrator-scheduler --target scheduler ./control-plane
```

### 4. Easier Testing

```bash
# Test control plane in isolation
cd control-plane && npm test

# Test data plane in isolation
cd data-plane && npm test

# Test shared code
cd shared && npm test
```

### 5. Team Ownership

| Team | Ownership |
|------|-----------|
| Platform Team | `control-plane/internal/{scheduler,registry}` |
| Security Team | `control-plane/internal/{auth,policy}` |
| Edge Team | `data-plane/internal/*` |
| Frontend Team | `frontend/*` |

## Implementation Timeline

### Week 1: Setup
- [ ] Create new folder structure
- [ ] Set up module imports
- [ ] Create symlinks for shared code

### Week 2: Control Plane Migration
- [ ] Move API routes
- [ ] Move scheduler service
- [ ] Move database layer
- [ ] Update imports

### Week 3: Data Plane Migration
- [ ] Move edge agent
- [ ] Create proper internal structure
- [ ] Update imports

### Week 4: Testing & Cleanup
- [ ] Run full test suite
- [ ] Update CI/CD pipelines
- [ ] Remove old structure
- [ ] Update documentation

## Commands Reference

```bash
# Development
make dev-control-plane  # Start control plane
make dev-data-plane     # Start data plane agent
make dev-frontend       # Start frontend
make dev-all            # Start everything

# Testing
make test-control-plane
make test-data-plane
make test-integration

# Building
make build-control-plane
make build-data-plane
make build-frontend

# Deployment
make deploy-control-plane ENV=production
make deploy-data-plane ENV=production
```

---

**Status**: Migration Plan Complete  
**Estimated Effort**: 4 weeks  
**Risk**: Medium (requires coordinated changes)
