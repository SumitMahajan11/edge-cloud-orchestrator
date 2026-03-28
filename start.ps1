#!/usr/bin/env pwsh
# Edge-Cloud Orchestrator - Easy Startup Script
# Usage: .\start.ps1 [mode] [-Detached]
# Modes: docker (default), dev, prod

param(
    [Parameter(Position=0)]
    [ValidateSet("docker", "dev", "prod", "infra", "services", "frontend")]
    [string]$Mode = "docker",

    [switch]$Detached,
    [switch]$SkipBuild,
    [switch]$SkipFrontend
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

# Colors for output
$Colors = @{
    Success = "Green"
    Error = "Red"
    Warning = "Yellow"
    Info = "Cyan"
    Header = "Magenta"
}

function Write-Header($text) {
    Write-Host "`n========================================" -ForegroundColor $Colors.Header
    Write-Host "  $text" -ForegroundColor $Colors.Header
    Write-Host "========================================" -ForegroundColor $Colors.Header
}

function Write-Status($text, $status = "Info") {
    $color = $Colors[$status]
    Write-Host "[$status] $text" -ForegroundColor $color
}

function Test-Command($command) {
    return [bool](Get-Command $command -ErrorAction SilentlyContinue)
}

function Wait-ForService($url, $name, $maxAttempts = 30) {
    Write-Status "Waiting for $name at $url..."
    for ($i = 1; $i -le $maxAttempts; $i++) {
        try {
            $response = Invoke-WebRequest -Uri $url -Method GET -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) {
                Write-Status "$name is ready!" "Success"
                return $true
            }
        } catch {}
        Write-Host "." -NoNewline -ForegroundColor $Colors.Warning
        Start-Sleep -Seconds 1
    }
    Write-Status "$name failed to start within $maxAttempts seconds" "Error"
    return $false
}

# ============================================
# DOCKER MODE (Recommended for quick start)
# ============================================
function Start-DockerMode() {
    Write-Header "Starting Edge-Cloud Orchestrator (Docker Mode)"

    if (-not (Test-Command "docker")) {
        Write-Status "Docker is not installed or not in PATH" "Error"
        exit 1
    }

    if (-not (Test-Command "docker-compose")) {
        Write-Status "Docker Compose is not installed" "Error"
        exit 1
    }

    Set-Location $ProjectRoot

    # Check if already running
    $running = docker-compose ps -q
    if ($running) {
        Write-Status "Services already running. Stopping first..." "Warning"
        docker-compose down
    }

    # Build and start
    if (-not $SkipBuild) {
        Write-Status "Building services..."
        docker-compose build --parallel
    }

    Write-Status "Starting all services..."
    if ($Detached) {
        docker-compose up -d
    } else {
        docker-compose up
        return
    }

    # Wait for services
    Write-Status "Waiting for services to be ready..."
    Start-Sleep -Seconds 5

    $services = @(
        @{ Name = "API Gateway"; Url = "http://localhost:80/health" },
        @{ Name = "Task Service"; Url = "http://localhost:3001/health" },
        @{ Name = "Node Service"; Url = "http://localhost:3002/health" },
        @{ Name = "Scheduler Service"; Url = "http://localhost:3003/health" },
        @{ Name = "WebSocket Gateway"; Url = "http://localhost:3004/health" },
        @{ Name = "Backend API"; Url = "http://localhost:3000/api/auth/health" }
    )

    $allReady = $true
    foreach ($svc in $services) {
        if (-not (Wait-ForService $svc.Url $svc.Name)) {
            $allReady = $false
        }
    }

    if ($allReady) {
        Write-Header "All Services Ready!"
        Write-Status "Frontend: http://localhost:5173" "Success"
        Write-Status "API Gateway: http://localhost:80" "Success"
        Write-Status "Grafana: http://localhost:3001 (admin/admin)" "Success"
        Write-Status "Prometheus: http://localhost:9090" "Success"
        Write-Status "Jaeger: http://localhost:16686" "Success"
        Write-Status "Vault: http://localhost:8200 (dev-token)" "Success"
        Write-Host "`nUse 'docker-compose logs -f' to view logs" -ForegroundColor $Colors.Info
        Write-Host "Use 'docker-compose down' to stop all services" -ForegroundColor $Colors.Info
    } else {
        Write-Status "Some services failed to start. Check logs with: docker-compose logs" "Error"
    }
}

# ============================================
# DEV MODE (Local development)
# ============================================
function Start-DevMode() {
    Write-Header "Starting Edge-Cloud Orchestrator (Dev Mode)"

    # Check prerequisites
    if (-not (Test-Command "node")) {
        Write-Status "Node.js is not installed" "Error"
        exit 1
    }

    # Start infrastructure only (Docker)
    Write-Status "Starting infrastructure services (Docker)..."
    Set-Location $ProjectRoot
    docker-compose up -d cockroachdb-1 cockroachdb-2 cockroachdb-3 cockroachdb-init zookeeper kafka-1 kafka-2 kafka-3 redis

    Write-Status "Waiting for infrastructure..."
    Start-Sleep -Seconds 10

    # Install dependencies if needed
    if (-not (Test-Path "$ProjectRoot\node_modules")) {
        Write-Status "Installing root dependencies..."
        npm install
    }

    # Start services in separate windows
    $services = @(
        @{ Name = "Task Service"; Path = "apps\task-service"; Port = 3001; Cmd = "npm run dev" },
        @{ Name = "Node Service"; Path = "apps\node-service"; Port = 3002; Cmd = "npm run dev" },
        @{ Name = "Scheduler Service"; Path = "apps\scheduler-service"; Port = 3003; Cmd = "npm run dev" },
        @{ Name = "Backend API"; Path = "backend"; Port = 3000; Cmd = "npm run dev" }
    )

    foreach ($svc in $services) {
        Write-Status "Starting $($svc.Name)..."
        $svcPath = Join-Path $ProjectRoot $svc.Path

        # Check if node_modules exists
        if (-not (Test-Path "$svcPath\node_modules")) {
            Write-Status "Installing dependencies for $($svc.Name)..."
            Set-Location $svcPath
            npm install
        }

        # Start in new window
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$svcPath'; $svc.Cmd" -WindowStyle Normal
    }

    # Start frontend
    if (-not $SkipFrontend) {
        Write-Status "Starting Frontend..."
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ProjectRoot'; npm run dev" -WindowStyle Normal
    }

    Write-Header "Development Environment Started!"
    Write-Status "Services are starting in separate windows" "Info"
    Write-Status "Frontend will be available at: http://localhost:5173" "Success"
}

# ============================================
# INFRASTRUCTURE ONLY MODE
# ============================================
function Start-Infrastructure() {
    Write-Header "Starting Infrastructure Only"

    Set-Location $ProjectRoot
    docker-compose up -d cockroachdb-1 cockroachdb-2 cockroachdb-3 cockroachdb-init zookeeper kafka-1 kafka-2 kafka-3 redis

    Write-Status "Waiting for databases..."
    Start-Sleep -Seconds 10

    Write-Status "Infrastructure ready!" "Success"
    Write-Status "CockroachDB: localhost:26257" "Info"
    Write-Status "Kafka: localhost:29092" "Info"
    Write-Status "Redis: localhost:6379" "Info"
}

# ============================================
# SERVICES ONLY MODE (with existing infra)
# ============================================
function Start-Services() {
    Write-Header "Starting Services Only"

    $services = @(
        @{ Name = "Task Service"; Path = "apps\task-service"; Cmd = "npm run dev" },
        @{ Name = "Node Service"; Path = "apps\node-service"; Cmd = "npm run dev" },
        @{ Name = "Scheduler Service"; Path = "apps\scheduler-service"; Cmd = "npm run dev" },
        @{ Name = "Backend API"; Path = "backend"; Cmd = "npm run dev" }
    )

    foreach ($svc in $services) {
        Write-Status "Starting $($svc.Name)..."
        $svcPath = Join-Path $ProjectRoot $svc.Path
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$svcPath'; $svc.Cmd" -WindowStyle Minimized
    }

    Write-Status "Services started in minimized windows" "Success"
}

# ============================================
# FRONTEND ONLY MODE
# ============================================
function Start-Frontend() {
    Write-Header "Starting Frontend Only"

    Set-Location $ProjectRoot

    if (-not (Test-Path "$ProjectRoot\node_modules")) {
        Write-Status "Installing dependencies..."
        npm install
    }

    npm run dev
}

# ============================================
# PROD MODE (Production build)
# ============================================
function Start-ProdMode() {
    Write-Header "Starting Edge-Cloud Orchestrator (Production Mode)"

    Set-Location $ProjectRoot

    # Build all services
    Write-Status "Building all services..."
    npm run build

    # Start with production compose
    docker-compose -f docker-compose.yml up -d

    Write-Status "Production environment started!" "Success"
}

# ============================================
# MAIN EXECUTION
# ============================================
Write-Header "Edge-Cloud Orchestrator Startup"
Write-Status "Mode: $Mode"
Write-Status "Project: $ProjectRoot"

switch ($Mode) {
    "docker" { Start-DockerMode }
    "dev" { Start-DevMode }
    "prod" { Start-ProdMode }
    "infra" { Start-Infrastructure }
    "services" { Start-Services }
    "frontend" { Start-Frontend }
    default { Write-Status "Unknown mode: $Mode" "Error"; exit 1 }
}
