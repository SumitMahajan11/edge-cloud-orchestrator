# Project Structure Guide

Complete overview of the Edge-Cloud Orchestrator codebase (251 files).

## Directory Map

```
edge-cloud-orchestrator/
│
├── apps/                          # Application code
│   ├── web/                       # React frontend (was: src/)
│   │   ├── components/            # UI components
│   │   ├── pages/                 # Route pages
│   │   ├── hooks/                 # Custom React hooks
│   │   ├── lib/                   # Utilities
│   │   ├── types/                 # TypeScript types
│   │   └── context/               # React context
│   │
│   ├── api/                       # Fastify backend (was: backend/)
│   │   ├── src/
│   │   │   ├── routes/            # API endpoints
│   │   │   ├── services/          # Business logic
│   │   │   ├── plugins/           # Fastify plugins
│   │   │   ├── database/          # DB client & migrations
│   │   │   ├── schemas/           # Zod validation schemas
│   │   │   ├── types/             # TypeScript types
│   │   │   └── utils/             # Utilities
│   │   ├── tests/
│   │   │   ├── unit/              # Unit tests
│   │   │   └── integration/       # Integration tests
│   │   ├── prisma/
│   │   │   └── schema.prisma      # Database schema
│   │   └── docker-compose.yml     # Local infrastructure
│   │
│   └── agent/                     # Edge node agent (was: edge-agent/)
│       ├── src/
│       │   └── server.js          # Agent service
│       └── Dockerfile
│
├── packages/                      # Shared packages
│   ├── shared/                    # Shared types & utilities
│   │   ├── types/                 # Common TypeScript types
│   │   └── utils/                 # Shared utilities
│   │
│   ├── database/                  # Database package
│   │   ├── prisma/
│   │   └── client.ts              # Prisma client with replicas
│   │
│   └── config/                    # Shared configurations
│       ├── eslint/
│       ├── typescript/
│       └── tailwind/
│
├── infra/                         # Infrastructure (was: infrastructure/)
│   ├── docker/                    # Docker compose files
│   ├── k8s/                       # Kubernetes manifests
│   └── scripts/                   # Deployment scripts
│
├── monitoring/                    # Observability
│   ├── prometheus/                # Metrics collection
│   ├── grafana/                   # Dashboards
│   └── load-tests/                # k6 tests
│
├── docs/                          # Documentation
│   ├── architecture/              # System design
│   ├── api/                       # API specs
│   └── deployment/                # Deployment guides
│
└── containers/                    # Task container templates
    ├── image-classifier/
    ├── data-aggregator/
    └── log-analyzer/
```

## Key Files by Purpose

### Entry Points
| File | Purpose |
|------|---------|
| `apps/web/src/main.tsx` | Frontend React app entry |
| `apps/api/src/index.ts` | Backend Fastify server entry |
| `apps/agent/src/server.js` | Edge agent entry |

### Configuration
| File | Purpose |
|------|---------|
| `apps/api/.env.example` | Backend environment template |
| `apps/api/prisma/schema.prisma` | Database schema |
| `apps/api/docker-compose.yml` | Local infrastructure |

### Core Services
| File | Purpose |
|------|---------|
| `apps/api/src/services/task-scheduler.ts` | Task scheduling with HA |
| `apps/api/src/services/websocket-manager.ts` | WebSocket handling |
| `apps/api/src/services/metrics-service.ts` | Prometheus metrics |

### API Routes
| File | Endpoints |
|------|-----------|
| `apps/api/src/routes/tasks-lifecycle.ts` | Task CRUD + lifecycle |
| `apps/api/src/routes/nodes.ts` | Edge node management |
| `apps/api/src/routes/auth.ts` | Authentication |
| `apps/api/src/routes/metrics.ts` | Metrics export |

### Tests
| File | Type |
|------|------|
| `apps/api/tests/unit/task-scheduler.test.ts` | Unit tests |
| `apps/api/tests/integration.test.ts` | Integration tests |
| `monitoring/load-tests/task-submit.js` | k6 load tests |

## Data Flow

```
User → Web App → API → Scheduler → Redis Queue → Agent → Docker
                ↓
           PostgreSQL (state)
```

## Quick Navigation

```bash
# Frontend
$ cd apps/web && npm run dev

# Backend
$ cd apps/api && npm run dev

# Agent
$ cd apps/agent && npm start

# Database
$ cd apps/api && npx prisma studio

# Tests
$ cd apps/api && npm test
```
