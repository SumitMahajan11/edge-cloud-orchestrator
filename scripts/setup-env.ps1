# Edge Cloud Orchestrator - Test Environment Setup Script
# Run this PowerShell script to set up the testing environment

Write-Host @"
╔══════════════════════════════════════════════════════════════╗
║     Edge Cloud Orchestrator - Test Environment Setup        ║
╚══════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan

# Check if Docker is installed
Write-Host "`n[1/5] Checking Docker installation..." -ForegroundColor Yellow
try {
    $dockerVersion = docker --version
    Write-Host "✓ Docker found: $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Docker not found. Please install Docker Desktop first." -ForegroundColor Red
    exit 1
}

# Check if Node.js is installed
Write-Host "`n[2/5] Checking Node.js installation..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "✓ Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Node.js not found. Please install Node.js first." -ForegroundColor Red
    exit 1
}

# Build container images
Write-Host "`n[3/5] Building container images..." -ForegroundColor Yellow

$images = @(
    @{ Name = "edgecloud-image-classifier"; Path = "./containers/image-classifier" },
    @{ Name = "edgecloud-data-aggregator"; Path = "./containers/data-aggregator" },
    @{ Name = "edgecloud-log-analyzer"; Path = "./containers/log-analyzer" }
)

foreach ($image in $images) {
    Write-Host "  Building $($image.Name)..." -ForegroundColor Gray
    docker build -t $image.Name $image.Path
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ $($image.Name) built successfully" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Failed to build $($image.Name)" -ForegroundColor Red
    }
}

# Install edge agent dependencies
Write-Host "`n[4/5] Installing edge agent dependencies..." -ForegroundColor Yellow
Set-Location -Path "./edge-agent"
if (Test-Path "package.json") {
    npm install
    Write-Host "✓ Edge agent dependencies installed" -ForegroundColor Green
} else {
    Write-Host "✗ package.json not found in edge-agent directory" -ForegroundColor Red
}
Set-Location -Path ".."

# Create startup script
Write-Host "`n[5/5] Creating startup scripts..." -ForegroundColor Yellow

$startScript = @'
@echo off
echo Starting Edge Cloud Test Environment...
echo.

REM Start 3 edge agents on different ports
start "Edge Agent 1" cmd /k "cd edge-agent && npm run agent-1"
timeout /t 2 >nul

start "Edge Agent 2" cmd /k "cd edge-agent && npm run agent-2"
timeout /t 2 >nul

start "Edge Agent 3" cmd /k "cd edge-agent && npm run agent-3"
timeout /t 2 >nul

echo.
echo Edge agents started on ports 4001, 4002, 4003
echo.
echo Next steps:
echo 1. Start the orchestrator dashboard: npm run dev
echo 2. Open http://localhost:5173
echo 3. Register the edge nodes in the dashboard
echo.
pause
'@

$startScript | Out-File -FilePath "start-test-env.bat" -Encoding ASCII
Write-Host "✓ Created start-test-env.bat" -ForegroundColor Green

# Summary
Write-Host @"

╔══════════════════════════════════════════════════════════════╗
║                    Setup Complete!                           ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Container Images Built:                                     ║
║    - edgecloud-image-classifier                              ║
║    - edgecloud-data-aggregator                               ║
║    - edgecloud-log-analyzer                                  ║
║                                                              ║
║  Edge Agent:                                                 ║
║    - Location: ./edge-agent/                                 ║
║    - Dependencies: Installed                                 ║
║                                                              ║
║  Next Steps:                                                 ║
║    1. Run: .\start-test-env.bat                             ║
║    2. Start orchestrator: npm run dev                       ║
║    3. Open: http://localhost:5173                           ║
║    4. Register edge nodes in dashboard                      ║
║                                                              ║
║  Edge Node Endpoints:                                        ║
║    - Node 1: http://localhost:4001                          ║
║    - Node 2: http://localhost:4002                          ║
║    - Node 3: http://localhost:4003                          ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan
