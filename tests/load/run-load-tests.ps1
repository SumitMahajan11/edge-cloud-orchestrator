# Load Test Orchestrator for Windows PowerShell
# This script runs the full suite of load tests and generates a BENCHMARK.md report.

Write-Host "=== Starting Edge-Cloud Orchestrator Load Test Suite (v4.0.0) ===" -ForegroundColor Cyan

# Ensure results directory exists
if (-not (Test-Path -Path "tests/load/results")) {
    New-Item -ItemType Directory -Path "tests/load/results" | Out-Null
}

# Set environment variables for the current session
$env:SCHEDULING_INTERVAL = "50"
$env:NODE_ENV = "development"
$env:FORCE_MOCK_DB = "true"
$env:FORCE_MOCK_REDIS = "true"
$env:REDIS_URL = ""
$env:JWT_SECRET = "load_test_secret_at_least_32_chars_long"
$env:HOST = "127.0.0.1"
$env:PORT = "3000"
$env:LOG_LEVEL = "debug"
$env:API_URL = "http://127.0.0.1:3000/v2"

Write-Host "[INFO] Starting API Server in MOCK mode (Interval: 50ms)..."

# Start the API gateway process in the background using cmd /c
$apiProcess = Start-Process cmd -ArgumentList "/c npx tsx apps/api/src/index.ts" -NoNewWindow -PassThru -RedirectStandardOutput "tests/load/results/api.log" -RedirectStandardError "tests/load/results/api-error.log"

if (-not $apiProcess) {
    Write-Error "Failed to start API server process"
    exit 1
}

# Wait for API to be ready
Write-Host "[INFO] Waiting for API readiness (health check)..."
$maxRetries = 60
$retryCount = 0
$ready = $false

while (-not $ready -and $retryCount -lt $maxRetries) {
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:3000/health" -Method Get -TimeoutSec 2
        if ($response.status -ne $null) {
            $ready = $true
        }
    } catch {
        # ignore connection error
    }
    
    if (-not $ready) {
        Start-Sleep -Seconds 1
        $retryCount++
        if ($retryCount % 5 -eq 0) {
            Write-Host "  Still waiting ($retryCount/60)..."
        }
    }
}

if (-not $ready) {
    Write-Host "[ERROR] API failed to start in 60s" -ForegroundColor Red
    if (Test-Path "tests/load/results/api.log") {
        Get-Content "tests/load/results/api.log" -Tail 20
    }
    if (Test-Path "tests/load/results/api-error.log") {
        Write-Host "Errors in api-error.log:"
        Get-Content "tests/load/results/api-error.log" -Tail 20
    }
    Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "[SUCCESS] API is ready!" -ForegroundColor Green

# Run Tests
try {
    Write-Host "[TEST] Running Latency Test..." -ForegroundColor Cyan
    npx tsx tests/load/scheduling-latency.ts

    Write-Host "[TEST] Running Capacity Test..." -ForegroundColor Cyan
    npx tsx tests/load/node-capacity.ts

    Write-Host "[TEST] Running Throughput Test..." -ForegroundColor Cyan
    npx tsx tests/load/throughput.ts
} catch {
    Write-Host "[ERROR] Test execution failed: $_" -ForegroundColor Red
} finally {
    # Cleanup
    Write-Host "[CLEANUP] Shutting down API..." -ForegroundColor Yellow
    # Stop cmd process and its children
    Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
}

# Generate BENCHMARK.md
Write-Host "[REPORT] Generating BENCHMARK.md..." -ForegroundColor Cyan
npx tsx tests/load/generate-benchmark-report.ts

Write-Host "[SUCCESS] All tests completed! Report generated in BENCHMARK.md" -ForegroundColor Green
