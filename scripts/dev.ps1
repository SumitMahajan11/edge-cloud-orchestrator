# Edge-Cloud Orchestrator - Unified Dev Script (Windows)
# This script automates the entire local development setup.

$ErrorActionPreference = "Stop"

Write-Host "==================================================" -ForegroundColor Blue
Write-Host "   Edge-Cloud Orchestrator - Local Dev Setup      " -ForegroundColor Blue
Write-Host "==================================================" -ForegroundColor Blue

# 1. Prerequisite Check
Write-Host "`n[1/7] Checking prerequisites..." -ForegroundColor Yellow
& powershell -ExecutionPolicy Bypass -File scripts/check-prerequisites.ps1

# 2. Environment Setup
Write-Host "`n[2/7] Setting up environment variables..." -ForegroundColor Yellow
if (-not (Test-Path .env)) {
    Write-Host "Creating .env from .env.example"
    Copy-Item .env.example .env
} else {
    Write-Host ".env file already exists, skipping."
}

# 3. Infrastructure Startup
Write-Host "`n[3/7] Starting infrastructure (Docker Compose)..." -ForegroundColor Yellow
docker compose -f infra/docker/docker-compose.yml up -d

# 4. Wait for Service Health
Write-Host "`n[4/7] Waiting for services to be healthy..." -ForegroundColor Yellow
Write-Host "Waiting for PostgreSQL (5432)..."
$ready = $false
while (-not $ready) {
    try {
        $containerId = docker ps -q -f name=postgres
        if ($containerId) {
            $output = docker exec $containerId pg_isready -U postgres
            if ($LASTEXITCODE -eq 0) { $ready = $true }
        }
    } catch {}
    if (-not $ready) {
        Write-Host -NoNewline "."
        Start-Sleep -Seconds 1
    }
}
Write-Host "`nPostgreSQL is ready!" -ForegroundColor Green

# 5. Database Migrations & Seeding
Write-Host "`n[5/7] Running Prisma migrations and seeding..." -ForegroundColor Yellow
pnpm --filter @edgecloud/api migrate:deploy
pnpm --filter @edgecloud/api seed

# 6. SDK & Documentation Generation
Write-Host "`n[6/7] Generating SDK and documentation..." -ForegroundColor Yellow
pnpm --filter @edgecloud/api gen:sdk
pnpm --filter @edgecloud/api gen:docs
pnpm --filter @edgecloud/api gen:postman

# 7. Start Applications
Write-Host "`n[7/7] Starting applications and mock agent..." -ForegroundColor Yellow
Write-Host "Ready to start! Watch mode enabled." -ForegroundColor Green

Write-Host "`n--------------------------------------------------" -ForegroundColor Blue
Write-Host "API:       http://localhost:3090" -ForegroundColor Green
Write-Host "Web:       http://localhost:3000" -ForegroundColor Green
Write-Host "Grafana:   http://localhost:3001 (admin/admin)" -ForegroundColor Green
Write-Host "API Docs:  http://localhost:3090/documentation" -ForegroundColor Green
Write-Host "--------------------------------------------------" -ForegroundColor Blue

# Start everything in parallel
pnpm --parallel dev
