# Edge-Cloud Orchestrator - Quick Start Guide

## Prerequisites

- **Docker & Docker Compose** (for full deployment)
- **Node.js 20+** (for development mode)
- **PowerShell** (Windows) or **Bash** (Linux/Mac)

## Quick Start (Recommended)

### Option 1: One-Command Docker Deployment

```powershell
# Windows
.\start.ps1 docker -Detached

# Or using npm
npm start
```

This starts everything:
- Frontend: http://localhost:5173
- API Gateway: http://localhost:80
- Grafana: http://localhost:3001 (admin/admin)
- Prometheus: http://localhost:9090
- Jaeger: http://localhost:16686
- Vault: http://localhost:8200 (dev-token)

### Option 2: Development Mode (Hot Reload)

```powershell
# Start infrastructure (Docker)
.\start.ps1 infra

# In separate terminals, start each service:
npm run start:services

# Start frontend
npm run start:frontend
```

### Option 3: Linux/Mac

```bash
chmod +x start.sh
./start.sh docker -d
```

## Available Commands

### PowerShell Script (Windows)

```powershell
.\start.ps1 [mode] [-Detached] [-SkipBuild] [-SkipFrontend]
```

**Modes:**
- `docker` - Full Docker deployment (default)
- `dev` - Local development with hot reload
- `infra` - Infrastructure only (DB, Kafka, Redis)
- `services` - Backend services only (requires infra)
- `frontend` - Frontend only
- `prod` - Production build

**Examples:**
```powershell
# Full Docker deployment in background
.\start.ps1 docker -Detached

# Development mode
.\start.ps1 dev

# Just infrastructure
.\start.ps1 infra

# Services with existing infrastructure
.\start.ps1 services
```

### NPM Scripts

```bash
# Quick start (Docker detached mode)
npm start

# Development mode
npm run start:dev

# Infrastructure only
npm run start:infra

# Services only
npm run start:services

# Frontend only
npm run start:frontend

# Build all
npm run build

# Development server
npm run dev

# Check health
npm run health
```

### Docker Compose

```bash
# Start everything
docker-compose up -d

# View logs
docker-compose logs -f

# Stop everything
docker-compose down

# Start specific services
docker-compose up -d task-service node-service

# Start observability stack
docker-compose up -d prometheus grafana jaeger
```

## Service Ports

| Service | Port | URL |
|---------|------|-----|
| Frontend | 5173 | http://localhost:5173 |
| API Gateway (Nginx) | 80 | http://localhost |
| Task Service | 3001 | http://localhost:3001 |
| Node Service | 3002 | http://localhost:3002 |
| Scheduler Service | 3003 | http://localhost:3003 |
| WebSocket Gateway | 3004 | ws://localhost:3004/ws |
| Backend API | 3000 | http://localhost:3000 |
| Grafana | 3001 | http://localhost:3001 |
| Prometheus | 9090 | http://localhost:9090 |
| Jaeger | 16686 | http://localhost:16686 |
| Vault | 8200 | http://localhost:8200 |
| CockroachDB | 26257 | localhost:26257 |
| Kafka | 29092 | localhost:29092 |
| Redis | 6379 | localhost:6379 |

## Troubleshooting

### Port Conflicts

If ports are already in use:
```powershell
# Find process using port 3000
netstat -ano | findstr :3000

# Kill process
taskkill /PID <PID> /F
```

### Docker Issues

```powershell
# Clean restart
docker-compose down -v
docker-compose up -d --build

# Check logs
docker-compose logs -f [service-name]

# Reset everything
docker system prune -a
docker-compose up -d --build
```

### Build Issues

```powershell
# Clean install
rm -rf node_modules
rm -rf apps/*/node_modules
rm -rf backend/node_modules
npm install

# Rebuild
npm run build
```

## Architecture Overview

```
┌─────────────────┐
│   Frontend      │  http://localhost:5173
│   (React/Vite)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  API Gateway    │  http://localhost:80
│    (Nginx)      │
└────────┬────────┘
         │
    ┌────┴────┬────────┬────────┬────────┐
    ▼         ▼        ▼        ▼        ▼
┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐
│ Tasks │ │ Nodes │ │Sched. │ │  WS   │ │Backend│
│:3001  │ │:3002  │ │:3003  │ │:3004  │ │:3000  │
└───┬───┘ └───┬───┘ └───┬───┘ └───────┘ └───┬───┘
    │         │         │                   │
    └─────────┴─────────┴───────────────────┘
              │
    ┌─────────┴─────────┐
    ▼                   ▼
┌─────────┐      ┌──────────┐
│Cockroach│      │  Kafka   │
│  :26257 │      │  :29092  │
└─────────┘      └──────────┘
```

## Next Steps

1. Open http://localhost:5173 in your browser
2. Login with default credentials (if auth is enabled)
3. Add edge nodes via the Nodes page
4. Submit tasks via the Scheduler page
5. Monitor metrics in Grafana at http://localhost:3001

## Development Workflow

1. Start infrastructure: `npm run start:infra`
2. Start services: `npm run start:services`
3. Start frontend: `npm run start:frontend`
4. Make changes - hot reload is active
5. Run tests: `npm test`

## Production Deployment

```powershell
# Build all services
npm run build

# Deploy with Docker
docker-compose -f docker-compose.yml up -d

# Or use Kubernetes
npm run k8s:apply
```
