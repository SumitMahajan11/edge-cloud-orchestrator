#!/bin/bash

# Edge-Cloud Orchestrator - Unified Dev Script
# This script automates the entire local development setup.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}==================================================${NC}"
echo -e "${BLUE}   Edge-Cloud Orchestrator - Local Dev Setup      ${NC}"
echo -e "${BLUE}==================================================${NC}"

# 1. Prerequisite Check
echo -e "\n${YELLOW}[1/7] Checking prerequisites...${NC}"
bash scripts/check-prerequisites.sh

# 2. Environment Setup
echo -e "\n${YELLOW}[2/7] Setting up environment variables...${NC}"
if [ ! -f .env ]; then
    echo -e "Creating .env from .env.example"
    cp .env.example .env
else
    echo -e ".env file already exists, skipping."
fi

# 3. Infrastructure Startup
echo -e "\n${YELLOW}[3/7] Starting infrastructure (Docker Compose)...${NC}"
docker compose -f infra/docker/docker-compose.yml up -d

# 4. Wait for Service Health
echo -e "\n${YELLOW}[4/7] Waiting for services to be healthy...${NC}"
# Simplified wait logic for local dev
echo "Waiting for PostgreSQL (5432)..."
until docker exec $(docker ps -q -f name=postgres) pg_isready -U postgres >/dev/null 2>&1; do
  echo -n "."
  sleep 1
done
echo -e "\n${GREEN}PostgreSQL is ready!${NC}"

# 5. Database Migrations & Seeding
echo -e "\n${YELLOW}[5/7] Running Prisma migrations and seeding...${NC}"
pnpm --filter @edgecloud/api migrate:deploy
pnpm --filter @edgecloud/api seed

# 6. SDK & Documentation Generation
echo -e "\n${YELLOW}[6/7] Generating SDK and documentation...${NC}"
pnpm --filter @edgecloud/api gen:sdk
pnpm --filter @edgecloud/api gen:docs
pnpm --filter @edgecloud/api gen:postman

# 7. Start Applications
echo -e "\n${YELLOW}[7/7] Starting applications and mock agent...${NC}"
echo -e "${GREEN}Ready to start! Watch mode enabled.${NC}"

echo -e "\n${BLUE}--------------------------------------------------${NC}"
echo -e "${GREEN}API:       http://localhost:3090${NC}"
echo -e "${GREEN}Web:       http://localhost:3000${NC}"
echo -e "${GREEN}Grafana:   http://localhost:3001 (admin/admin)${NC}"
echo -e "${GREEN}API Docs:  http://localhost:3090/documentation${NC}"
echo -e "${BLUE}--------------------------------------------------${NC}"

# Start everything in parallel
# We use pnpm --parallel to start all dev scripts
# We also want to start the mock-agent
pnpm --parallel dev
