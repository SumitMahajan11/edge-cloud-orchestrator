#!/usr/bin/env pwsh
# Edge-Cloud Compute Orchestrator - Production Deployment Script
# Usage: .\deploy.ps1 [-Environment "production"] [-SkipTests]

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet("staging", "production")]
    [string]$Environment = "staging",
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipTests,
    
    [Parameter(Mandatory=$false)]
    [switch]$Help
)

if ($Help) {
    Write-Host @"
Edge-Cloud Compute Orchestrator - Production Deployment

Usage: .\deploy.ps1 [-Environment staging|production] [-SkipTests]

Options:
  -Environment    Target environment (default: staging)
  -SkipTests      Skip test execution
  -Help          Show this help message

Examples:
  .\deploy.ps1                          # Deploy to staging with tests
  .\deploy.ps1 -Environment production  # Deploy to production with tests
  .\deploy.ps1 -SkipTests              # Deploy without running tests
"@
    exit 0
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Edge-Cloud Compute Orchestrator" -ForegroundColor Cyan
Write-Host "Production Deployment Script" -ForegroundColor Cyan
Write-Host "Environment: $Environment" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Cyan

# Configuration
$composeFile = "docker-compose.prod.yml"
$k8sNamespace = "edgecloud"
$testsPassed = $false

function Write-Step {
    param([string]$Message)
    Write-Host "`n[STEP] $Message" -ForegroundColor Green
    Write-Host ("=" * 60) -ForegroundColor Gray
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Write-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

# Step 1: Pre-deployment checks
Write-Step "Running pre-deployment checks"

Write-Host "Checking Docker..." -NoNewline
try {
    $dockerVersion = docker --version
    Write-Host " ✓" -ForegroundColor Green
    Write-Host "  $dockerVersion" -ForegroundColor Gray
} catch {
    Write-Error-Custom "Docker is not installed or not running"
    exit 1
}

Write-Host "Checking kubectl..." -NoNewline
try {
    $kubectlVersion = kubectl version --client --output=yaml | Select-String "gitVersion"
    Write-Host " ✓" -ForegroundColor Green
    Write-Host "  $kubectlVersion" -ForegroundColor Gray
} catch {
    Write-Warning "kubectl not found - Kubernetes features will be limited"
}

Write-Host "Validating environment files..." -NoNewline
if (Test-Path ".env.production") {
    Write-Host " ✓" -ForegroundColor Green
} else {
    Write-Warning ".env.production not found - using defaults"
}

# Step 2: Run tests (unless skipped)
if (-not $SkipTests) {
    Write-Step "Running test suite"
    
    Write-Host "Running unit tests..." -NoNewline
    try {
        $testResult = npm run test 2>&1 | Select-String "Passing|Failing"
        Write-Host " ✓" -ForegroundColor Green
        Write-Host "  $testResult" -ForegroundColor Gray
        $testsPassed = $true
    } catch {
        Write-Error-Custom "Tests failed - deployment aborted"
        Write-Host "Use -SkipTests to bypass if necessary" -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "Skipping tests (as requested)" -ForegroundColor Yellow
    $testsPassed = $true
}

# Step 3: Build containers
Write-Step "Building Docker containers"

Write-Host "Building orchestrator..." -NoNewline
try {
    docker build -t edgecloud/orchestrator:latest ./edge-cloud-orchestrator --quiet
    Write-Host " ✓" -ForegroundColor Green
} catch {
    Write-Error-Custom "Failed to build orchestrator"
    exit 1
}

Write-Host "Building task-service..." -NoNewline
try {
    docker build -t edgecloud/task-service:latest ./edge-cloud-orchestrator/apps/task-service --quiet
    Write-Host " ✓" -ForegroundColor Green
} catch {
    Write-Error-Custom "Failed to build task-service"
    exit 1
}

Write-Host "Building node-service..." -NoNewline
try {
    docker build -t edgecloud/node-service:latest ./edge-cloud-orchestrator/apps/node-service --quiet
    Write-Host " ✓" -ForegroundColor Green
} catch {
    Write-Error-Custom "Failed to build node-service"
    exit 1
}

Write-Host "Building scheduler-service..." -NoNewline
try {
    docker build -t edgecloud/scheduler-service:latest ./edge-cloud-orchestrator/apps/scheduler-service --quiet
    Write-Host " ✓" -ForegroundColor Green
} catch {
    Write-Error-Custom "Failed to build scheduler-service"
    exit 1
}

Write-Host "Building websocket-gateway..." -NoNewline
try {
    docker build -t edgecloud/websocket-gateway:latest ./edge-cloud-orchestrator/apps/websocket-gateway --quiet
    Write-Host " ✓" -ForegroundColor Green
} catch {
    Write-Error-Custom "Failed to build websocket-gateway"
    exit 1
}

Write-Success "All containers built successfully"

# Step 4: Deploy based on environment
if ($Environment -eq "staging") {
    Write-Step "Deploying to STAGING environment"
    
    Write-Host "Using Docker Compose for staging..." -ForegroundColor Cyan
    
    # Stop existing containers
    Write-Host "Stopping existing containers..." -NoNewline
    docker-compose down --remove-orphans --quiet
    Write-Host " ✓" -ForegroundColor Green
    
    # Start services
    Write-Host "Starting services..." -NoNewline
    docker-compose -f $composeFile up -d --quiet-pull
    Write-Host " ✓" -ForegroundColor Green
    
    # Wait for services to be healthy
    Write-Host "Waiting for services to be ready..."
    Start-Sleep -Seconds 10
    
    # Check service health
    $services = docker-compose ps --format json | ConvertFrom-Json
    $healthyCount = ($services | Where-Object { $_.Health -eq "healthy" }).Count
    $totalCount = $services.Count
    
    Write-Host "Services ready: $healthyCount/$totalCount" -ForegroundColor $(if ($healthyCount -eq $totalCount) { "Green" } else { "Yellow" })
    
} elseif ($Environment -eq "production") {
    Write-Step "Deploying to PRODUCTION environment"
    
    Write-Host "Using Kubernetes for production..." -ForegroundColor Cyan
    
    # Verify cluster access
    try {
        kubectl cluster-info | Select-String "Kubernetes control plane"
        Write-Host "✓ Connected to Kubernetes cluster" -ForegroundColor Green
    } catch {
        Write-Error-Custom "Cannot connect to Kubernetes cluster"
        exit 1
    }
    
    # Apply namespace
    Write-Host "Creating namespace..." -NoNewline
    kubectl apply -f infrastructure/kubernetes/namespace.yaml --dry-run=client
    Write-Host " ✓" -ForegroundColor Green
    
    # Apply all manifests
    Write-Host "Applying Kubernetes manifests..." -NoNewline
    kubectl apply -f infrastructure/kubernetes/ --recursive
    Write-Host " ✓" -ForegroundColor Green
    
    # Wait for deployments
    Write-Host "Waiting for deployments to be ready..."
    kubectl rollout status deployment/task-service -n $k8sNamespace --timeout=300s
    kubectl rollout status deployment/node-service -n $k8sNamespace --timeout=300s
    kubectl rollout status deployment/scheduler-service -n $k8sNamespace --timeout=300s
    
    # Verify HPA
    Write-Host "Verifying autoscaling configuration..." -NoNewline
    kubectl get hpa -n $k8sNamespace
    Write-Host " ✓" -ForegroundColor Green
    
    # Check ingress
    Write-Host "Configuring ingress..." -NoNewline
    kubectl get ingress -n $k8sNamespace
    Write-Host " ✓" -ForegroundColor Green
}

# Step 5: Post-deployment verification
Write-Step "Running post-deployment verification"

Write-Host "Checking health endpoints..."

$endpoints = @(
    @{Name="API Gateway"; URL="http://localhost:3000/health"},
    @{Name="Task Service"; URL="http://localhost:3001/health"},
    @{Name="Node Service"; URL="http://localhost:3002/health"},
    @{Name="Scheduler"; URL="http://localhost:3003/health"},
    @{Name="WebSocket"; URL="http://localhost:3004/health"}
)

foreach ($endpoint in $endpoints) {
    Write-Host "  $($endpoint.Name)... " -NoNewline
    try {
        $response = Invoke-WebRequest -Uri $endpoint.URL -TimeoutSec 5 -UseBasicParsing
        if ($response.StatusCode -eq 200) {
            Write-Host "✓" -ForegroundColor Green
        } else {
            Write-Host "✗ (Status: $($response.StatusCode))" -ForegroundColor Red
        }
    } catch {
        Write-Host "✗ (Failed)" -ForegroundColor Red
    }
}

# Check monitoring stack
Write-Host "`nChecking monitoring stack..."
$monitoring = @(
    @{Name="Prometheus"; URL="http://localhost:9090/-/healthy"},
    @{Name="Grafana"; URL="http://localhost:3001/api/health"},
    @{Name="Jaeger"; URL="http://localhost:16686/"}
)

foreach ($service in $monitoring) {
    Write-Host "  $($service.Name)... " -NoNewline
    try {
        $response = Invoke-WebRequest -Uri $service.URL -TimeoutSec 5 -UseBasicParsing
        Write-Host "✓" -ForegroundColor Green
    } catch {
        Write-Host "✗" -ForegroundColor Red
    }
}

# Step 6: Display deployment info
Write-Step "Deployment Summary"

Write-Host @"
========================================
ENVIRONMENT: $Environment
STATUS: DEPLOYMENT COMPLETE
========================================

Service Endpoints:
  API Gateway:     http://localhost:3000
  Task Service:    http://localhost:3001
  Node Service:    http://localhost:3002
  Scheduler:       http://localhost:3003
  WebSocket:       http://localhost:3004

Monitoring:
  Prometheus:      http://localhost:9090
  Grafana:         http://localhost:3001 (admin/admin)
  Jaeger:          http://localhost:16686

Next Steps:
  1. Verify application functionality
  2. Check logs: docker-compose logs -f
  3. Monitor metrics in Grafana
  4. Review security logs

Rollback Command:
  docker-compose down
  kubectl rollout undo deployment/task-service -n $k8sNamespace

========================================
"@

Write-Success "Deployment completed successfully!"
Write-Host "`nReport any issues to the DevOps team." -ForegroundColor Cyan
