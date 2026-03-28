#!/usr/bin/env pwsh
# Setup script for Edge-Cloud Orchestrator
# Installs dependencies and builds all packages

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Edge-Cloud Orchestrator Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Set-Location $ProjectRoot

# Check Node.js version
$nodeVersion = node --version
Write-Host "Node.js version: $nodeVersion" -ForegroundColor Green

# Install root dependencies
Write-Host "`n[1/5] Installing root dependencies..." -ForegroundColor Yellow
npm install

# Install package dependencies
Write-Host "`n[2/5] Installing package dependencies..." -ForegroundColor Yellow
$packages = @(
    "packages/shared-kernel",
    "packages/event-bus",
    "packages/circuit-breaker",
    "packages/security",
    "packages/observability",
    "packages/chaos",
    "packages/analytics",
    "packages/performance",
    "packages/scheduler",
    "packages/sandbox",
    "packages/websocket-client",
    "packages/ml-scheduler",
    "packages/raft-consensus",
    "packages/integration"
)

foreach ($pkg in $packages) {
    Write-Host "  - $pkg" -ForegroundColor Gray
    Set-Location (Join-Path $ProjectRoot $pkg)
    if (Test-Path "package.json") {
        npm install
    }
}

# Build packages in order
Write-Host "`n[3/5] Building packages..." -ForegroundColor Yellow

# Build shared-kernel first (dependency of others)
Write-Host "  - Building shared-kernel..." -ForegroundColor Gray
Set-Location (Join-Path $ProjectRoot "packages/shared-kernel")
npm run build

# Build remaining packages
$buildOrder = @(
    "packages/event-bus",
    "packages/circuit-breaker",
    "packages/security",
    "packages/observability",
    "packages/chaos",
    "packages/analytics",
    "packages/performance",
    "packages/scheduler",
    "packages/sandbox",
    "packages/websocket-client",
    "packages/ml-scheduler",
    "packages/raft-consensus",
    "packages/integration"
)

foreach ($pkg in $buildOrder) {
    Write-Host "  - Building $pkg..." -ForegroundColor Gray
    Set-Location (Join-Path $ProjectRoot $pkg)
    if (Test-Path "package.json") {
        npm run build
    }
}

# Install app dependencies
Write-Host "`n[4/5] Installing app dependencies..." -ForegroundColor Yellow
$apps = @(
    "apps/task-service",
    "apps/node-service",
    "apps/scheduler-service",
    "apps/websocket-gateway"
)

foreach ($app in $apps) {
    Write-Host "  - $app" -ForegroundColor Gray
    Set-Location (Join-Path $ProjectRoot $app)
    if (Test-Path "package.json") {
        npm install
    }
}

# Install backend dependencies
Write-Host "`n[5/5] Installing backend dependencies..." -ForegroundColor Yellow
Set-Location (Join-Path $ProjectRoot "backend")
npm install

# Generate Prisma client
Write-Host "  - Generating Prisma client..." -ForegroundColor Gray
npx prisma generate

Set-Location $ProjectRoot

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "  1. Start infrastructure: .\start.ps1 infra" -ForegroundColor White
Write-Host "  2. Start services: .\start.ps1 services" -ForegroundColor White
Write-Host "  3. Start frontend: .\start.ps1 frontend" -ForegroundColor White
Write-Host "`nOr start everything with Docker:" -ForegroundColor Cyan
Write-Host "  .\start.ps1 docker -Detached" -ForegroundColor White
