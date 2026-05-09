#!/bin/bash

# Edge-Cloud Orchestrator - Prerequisite Check Script
# This script ensures the local environment has all necessary tools installed.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Checking prerequisites for Edge-Cloud Orchestrator dev environment...${NC}"

FAILED=0

# 1. Node.js >= 22.0.0
if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node -v | cut -d 'v' -f 2)
    MAJOR_VERSION=$(echo $NODE_VERSION | cut -d '.' -f 1)
    if [ "$MAJOR_VERSION" -lt 22 ]; then
        echo -e "${RED}✘ Node.js version is $NODE_VERSION, but >= 22.0.0 is required.${NC}"
        echo "   Install from: https://nodejs.org/"
        FAILED=1
    else
        echo -e "${GREEN}✔ Node.js $NODE_VERSION${NC}"
    fi
else
    echo -e "${RED}✘ Node.js not found.${NC}"
    echo "   Install from: https://nodejs.org/"
    FAILED=1
fi

# 2. pnpm >= 9.0.0
if command -v pnpm >/dev/null 2>&1; then
    PNPM_VERSION=$(pnpm -v)
    MAJOR_VERSION=$(echo $PNPM_VERSION | cut -d '.' -f 1)
    if [ "$MAJOR_VERSION" -lt 9 ]; then
        echo -e "${RED}✘ pnpm version is $PNPM_VERSION, but >= 9.0.0 is required.${NC}"
        echo "   Install with: npm install -g pnpm"
        FAILED=1
    else
        echo -e "${GREEN}✔ pnpm $PNPM_VERSION${NC}"
    fi
else
    echo -e "${RED}✘ pnpm not found.${NC}"
    echo "   Install with: npm install -g pnpm"
    FAILED=1
fi

# 3. Docker >= 24.0.0
if command -v docker >/dev/null 2>&1; then
    DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || docker -v | cut -d ' ' -f 3 | cut -d ',' -f 1)
    MAJOR_VERSION=$(echo $DOCKER_VERSION | cut -d '.' -f 1)
    if [ "$MAJOR_VERSION" -lt 24 ]; then
        echo -e "${RED}✘ Docker version is $DOCKER_VERSION, but >= 24.0.0 is required.${NC}"
        echo "   Install from: https://docs.docker.com/get-docker/"
        FAILED=1
    else
        echo -e "${GREEN}✔ Docker $DOCKER_VERSION${NC}"
    fi
else
    echo -e "${RED}✘ Docker not found.${NC}"
    echo "   Install from: https://docs.docker.com/get-docker/"
    FAILED=1
fi

# 4. Docker Compose >= 2.0.0
if docker compose version >/dev/null 2>&1; then
    COMPOSE_VERSION=$(docker compose version --short)
    echo -e "${GREEN}✔ Docker Compose $COMPOSE_VERSION${NC}"
elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_VERSION=$(docker-compose version --short)
    echo -e "${GREEN}✔ Docker Compose $COMPOSE_VERSION${NC}"
else
    echo -e "${RED}✘ Docker Compose (v2) not found.${NC}"
    echo "   Install from: https://docs.docker.com/compose/install/"
    FAILED=1
fi

# 5. Rust >= 1.78
if command -v rustc >/dev/null 2>&1; then
    RUST_VERSION=$(rustc --version | cut -d ' ' -f 2)
    MINOR_VERSION=$(echo $RUST_VERSION | cut -d '.' -f 2)
    if [ "$MINOR_VERSION" -lt 78 ]; then
        echo -e "${RED}✘ Rust version is $RUST_VERSION, but >= 1.78 is required.${NC}"
        echo "   Install from: https://rustup.rs/"
        FAILED=1
    else
        echo -e "${GREEN}✔ Rust $RUST_VERSION${NC}"
    fi
else
    echo -e "${YELLOW}! Rust not found. This is optional unless you are developing the agent.${NC}"
    echo "   Install from: https://rustup.rs/ if needed."
fi

if [ $FAILED -eq 1 ]; then
    echo -e "\n${RED}Prerequisite check failed. Please install missing tools and try again.${NC}"
    exit 1
else
    echo -e "\n${GREEN}All mandatory prerequisites passed!${NC}"
    exit 0
fi
