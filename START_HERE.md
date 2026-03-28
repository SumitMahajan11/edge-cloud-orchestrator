# Start Here

New to this project? Read this first.

## What Is This?

A distributed computing platform that runs tasks on edge nodes (computers near users) instead of centralized cloud servers.

**Simple analogy**: Like Uber for computing - tasks get scheduled to the nearest available "driver" (edge node).

## 3-Minute Quickstart

```bash
# 1. Start the database and message queue
cd backend && docker compose up -d postgres redis rabbitmq

# 2. Set up the database
npx prisma migrate dev

# 3. Start the backend API
cd backend && npm run dev

# 4. In a new terminal, start the frontend
npm run dev

# 5. Open http://localhost:5173
```

## Project Layout (Simplified)

```
┌─────────────────────────────────────────────┐
│  Frontend (React)  ←── You are here         │
│  Port: 5173                                 │
│  Path: src/                                 │
└──────────────────┬──────────────────────────┘
                   │ HTTP/WebSocket
                   ▼
┌─────────────────────────────────────────────┐
│  Backend (Fastify API)                      │
│  Port: 3000                                 │
│  Path: backend/src/                         │
│                                             │
│  Key files:                                 │
│  - routes/tasks-lifecycle.ts  (Task API)    │
│  - services/task-scheduler.ts (Scheduler)   │
└──────────────────┬──────────────────────────┘
                   │ HTTP
                   ▼
┌─────────────────────────────────────────────┐
│  Edge Agent (Node.js)                       │
│  Port: 4001-4003                            │
│  Path: edge-agent/                          │
│                                             │
│  Runs Docker containers on edge nodes       │
└─────────────────────────────────────────────┘
```

## Key Concepts

| Term | Meaning |
|------|---------|
| **Task** | A unit of work (e.g., "classify these images") |
| **Edge Node** | A computer that runs tasks (like a mini server) |
| **Scheduler** | Decides which node runs which task |
| **Agent** | Software on each node that runs the task |

## Common Tasks

### Add a new API endpoint

```typescript
// backend/src/routes/my-feature.ts
export default async function myFeatureRoutes(fastify: FastifyInstance) {
  fastify.get('/my-endpoint', async (request, reply) => {
    return { message: 'Hello' }
  })
}
```

### Run tests

```bash
cd backend
npm test              # Unit tests
npm run test:integration  # Integration tests
```

### Check logs

```bash
# Backend logs
cd backend && npm run dev

# Docker logs
docker compose logs -f backend
```

## File Guide

| If you want to... | Look in... |
|-------------------|-----------|
| Change the UI | `src/components/` |
| Add an API endpoint | `backend/src/routes/` |
| Fix task scheduling | `backend/src/services/task-scheduler.ts` |
| Change database schema | `backend/prisma/schema.prisma` |
| Add tests | `backend/tests/` |
| Configure deployment | `infrastructure/docker/` |

## Troubleshooting

**Port already in use?**
```bash
# Find and kill process
npx kill-port 3000 5173 4001
```

**Database connection error?**
```bash
# Restart infrastructure
cd backend && docker compose restart
```

**TypeScript errors?**
```bash
cd backend && npx tsc --noEmit
```

## Next Steps

1. Read [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md) for full layout
2. Check [backend/src/services/task-scheduler.ts](backend/src/services/task-scheduler.ts) - core scheduling logic
3. Review [backend/prisma/schema.prisma](backend/prisma/schema.prisma) - data model

## Architecture Decision Records

- **Monorepo**: All code in one repo for simplicity
- **Fastify over Express**: Better TypeScript support, faster
- **PostgreSQL + Redis**: Reliable state + fast caching
- **Docker Compose**: Easy local development
- **Leader Election**: Scheduler HA via Redis locks
