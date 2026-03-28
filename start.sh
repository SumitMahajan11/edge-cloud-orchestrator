#!/bin/bash
# Edge-Cloud Orchestrator - Easy Startup Script (Linux/Mac)
# Usage: ./start.sh [mode] [-d|--detached]
# Modes: docker (default), dev, prod, infra, services, frontend

set -e

MODE="${1:-docker}"
DETACHED=false
SKIP_BUILD=false
SKIP_FRONTEND=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        -d|--detached) DETACHED=true ;;
        --skip-build) SKIP_BUILD=true ;;
        --skip-frontend) SKIP_FRONTEND=true ;;
    esac
done

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

header() {
    echo -e "${MAGENTA}"
    echo "========================================"
    echo "  $1"
    echo "========================================"
    echo -e "${NC}"
}

status() {
    local color=$CYAN
    case "$2" in
        success) color=$GREEN ;;
        error) color=$RED ;;
        warning) color=$YELLOW ;;
    esac
    echo -e "${color}[$1] $3${NC}"
}

wait_for_service() {
    local url=$1
    local name=$2
    local max_attempts=${3:-30}

    status "INFO" "" "Waiting for $name at $url..."

    for ((i=1; i<=max_attempts; i++)); do
        if curl -s "$url" > /dev/null 2>&1; then
            status "SUCCESS" success "$name is ready!"
            return 0
        fi
        echo -n "."
        sleep 1
    done

    status "ERROR" error "$name failed to start within $max_attempts seconds"
    return 1
}

# ============================================
# DOCKER MODE
# ============================================
start_docker() {
    header "Starting Edge-Cloud Orchestrator (Docker Mode)"

    if ! command -v docker &> /dev/null; then
        status "ERROR" error "Docker is not installed"
        exit 1
    fi

    if ! command -v docker-compose &> /dev/null; then
        status "ERROR" error "Docker Compose is not installed"
        exit 1
    fi

    # Check if already running
    if docker-compose ps -q | grep -q .; then
        status "WARNING" warning "Services already running. Stopping first..."
        docker-compose down
    fi

    # Build
    if [ "$SKIP_BUILD" = false ]; then
        status "INFO" "" "Building services..."
        docker-compose build --parallel
    fi

    status "INFO" "" "Starting all services..."
    if [ "$DETACHED" = true ]; then
        docker-compose up -d
    else
        docker-compose up
        return
    fi

    # Wait for services
    status "INFO" "" "Waiting for services to be ready..."
    sleep 5

    declare -A services=(
        ["API Gateway"]="http://localhost:80/health"
        ["Task Service"]="http://localhost:3001/health"
        ["Node Service"]="http://localhost:3002/health"
        ["Scheduler Service"]="http://localhost:3003/health"
        ["WebSocket Gateway"]="http://localhost:3004/health"
        ["Backend API"]="http://localhost:3000/api/auth/health"
    )

    all_ready=true
    for name in "${!services[@]}"; do
        if ! wait_for_service "${services[$name]}" "$name"; then
            all_ready=false
        fi
    done

    if [ "$all_ready" = true ]; then
        header "All Services Ready!"
        status "SUCCESS" success "Frontend: http://localhost:5173"
        status "SUCCESS" success "API Gateway: http://localhost:80"
        status "SUCCESS" success "Grafana: http://localhost:3001 (admin/admin)"
        status "SUCCESS" success "Prometheus: http://localhost:9090"
        status "SUCCESS" success "Jaeger: http://localhost:16686"
        echo ""
        echo "Use 'docker-compose logs -f' to view logs"
        echo "Use 'docker-compose down' to stop all services"
    else
        status "ERROR" error "Some services failed to start. Check logs with: docker-compose logs"
    fi
}

# ============================================
# DEV MODE
# ============================================
start_dev() {
    header "Starting Edge-Cloud Orchestrator (Dev Mode)"

    if ! command -v node &> /dev/null; then
        status "ERROR" error "Node.js is not installed"
        exit 1
    fi

    # Start infrastructure
    status "INFO" "" "Starting infrastructure services..."
    docker-compose up -d cockroachdb-1 cockroachdb-2 cockroachdb-3 cockroachdb-init zookeeper kafka-1 kafka-2 kafka-3 redis

    status "INFO" "" "Waiting for infrastructure..."
    sleep 10

    # Install dependencies
    if [ ! -d "node_modules" ]; then
        status "INFO" "" "Installing root dependencies..."
        npm install
    fi

    # Start services in background
    declare -A services=(
        ["apps/task-service"]="Task Service:3001"
        ["apps/node-service"]="Node Service:3002"
        ["apps/scheduler-service"]="Scheduler Service:3003"
        ["backend"]="Backend API:3000"
    )

    for path in "${!services[@]}"; do
        IFS=':' read -r name port <<< "${services[$path]}"
        status "INFO" "" "Starting $name..."

        if [ ! -d "$path/node_modules" ]; then
            (cd "$path" && npm install)
        fi

        # Start in background
        (cd "$path" && npm run dev &) > /dev/null 2>&1
    done

    # Start frontend
    if [ "$SKIP_FRONTEND" = false ]; then
        status "INFO" "" "Starting Frontend..."
        npm run dev &
    fi

    header "Development Environment Started!"
    status "SUCCESS" success "Services are running in background"
    status "SUCCESS" success "Frontend: http://localhost:5173"
    echo ""
    echo "Use 'pkill -f node' to stop all Node.js services"
}

# ============================================
# INFRASTRUCTURE ONLY
# ============================================
start_infra() {
    header "Starting Infrastructure Only"
    docker-compose up -d cockroachdb-1 cockroachdb-2 cockroachdb-3 cockroachdb-init zookeeper kafka-1 kafka-2 kafka-3 redis
    sleep 10
    header "Infrastructure Ready!"
    status "SUCCESS" success "CockroachDB: localhost:26257"
    status "SUCCESS" success "Kafka: localhost:29092"
    status "SUCCESS" success "Redis: localhost:6379"
}

# ============================================
# SERVICES ONLY
# ============================================
start_services() {
    header "Starting Services Only"

    declare -A services=(
        ["apps/task-service"]="Task Service"
        ["apps/node-service"]="Node Service"
        ["apps/scheduler-service"]="Scheduler Service"
        ["backend"]="Backend API"
    )

    for path in "${!services[@]}"; do
        status "INFO" "" "Starting ${services[$path]}..."
        (cd "$path" && npm run dev &) > /dev/null 2>&1
    done

    status "SUCCESS" success "Services started in background"
}

# ============================================
# FRONTEND ONLY
# ============================================
start_frontend() {
    header "Starting Frontend Only"
    if [ ! -d "node_modules" ]; then
        npm install
    fi
    npm run dev
}

# ============================================
# PROD MODE
# ============================================
start_prod() {
    header "Starting Production Mode"
    npm run build
    docker-compose up -d
    status "SUCCESS" success "Production environment started!"
}

# ============================================
# MAIN
# ============================================
header "Edge-Cloud Orchestrator Startup"
status "INFO" "" "Mode: $MODE"
status "INFO" "" "Project: $PROJECT_ROOT"

case "$MODE" in
    docker) start_docker ;;
    dev) start_dev ;;
    prod) start_prod ;;
    infra) start_infra ;;
    services) start_services ;;
    frontend) start_frontend ;;
    *)
        echo "Usage: $0 [docker|dev|prod|infra|services|frontend] [-d|--detached]"
        exit 1
        ;;
esac
