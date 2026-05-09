# Edge-Cloud Orchestrator - Prerequisite Check (Windows)
Write-Host "Checking prerequisites..." -ForegroundColor Yellow
$failed = $false

# Node.js
try {
    $v = node -v
    Write-Host "OK: Node.js $v" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Node.js is missing. Install from https://nodejs.org/" -ForegroundColor Red
    $failed = $true
}

# pnpm
try {
    $v = pnpm -v
    Write-Host "OK: pnpm $v" -ForegroundColor Green
} catch {
    Write-Host "ERROR: pnpm is missing. Run: npm install -g pnpm" -ForegroundColor Red
    $failed = $true
}

# Docker
try {
    $v = docker -v
    Write-Host "OK: $v" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Docker is missing. Install from https://docs.docker.com/get-docker/" -ForegroundColor Red
    $failed = $true
}

# Docker Compose
try {
    $v = docker compose version --short
    Write-Host "OK: Docker Compose $v" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Docker Compose is missing." -ForegroundColor Red
    $failed = $true
}

if ($failed) {
    Write-Host "`nPrerequisite check failed." -ForegroundColor Red
    exit 1
} else {
    Write-Host "`nAll prerequisites passed!" -ForegroundColor Green
    exit 0
}
