.PHONY: dev test test-e2e build lint seed-ml migrate help

dev:        ## Start local development environment
	./scripts/dev.sh

test:       ## Run full test suite
	pnpm test

test-e2e:   ## Run E2E tests
	pnpm test tests/e2e/

build:      ## Build all Docker images
	docker build -t eco-api:latest -f apps/api/Dockerfile .
	docker build -t eco-web:latest -f apps/web/Dockerfile .
	docker build -t eco-agent:latest -f apps/agent/Dockerfile .

lint:       ## Run linter
	pnpm lint

seed-ml:    ## Seed initial ML model
	pnpm --filter @edgecloud/api exec tsx src/database/seed-ml.ts

migrate:    ## Run database migrations
	pnpm --filter @edgecloud/api exec prisma migrate deploy

help:       ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
