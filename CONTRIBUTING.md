# Contributing to Edge-Cloud Orchestrator

Welcome! This document will help you get started with local development.

## 🚀 Quick Start

The fastest way to get started is to use the unified dev script:

### Windows

```powershell
./scripts/dev.ps1
```

### Linux / macOS

```bash
bash scripts/dev.sh
```

This single command will:

1. Check for prerequisites (Node.js 22, pnpm 9, Docker, Rust).
2. Set up your `.env` file.
3. Start infrastructure services (Postgres, Redis, Vault, etc.) via Docker.
4. Run database migrations and seed realistic data.
5. Start all applications in parallel watch mode.

---

## 🏗 Architecture Overview

- **`apps/api`**: Fastify-based backend. Handles scheduling, orchestration, and API requests.
- **`apps/web`**: Next.js frontend dashboard.
- **`apps/agent`**: Rust-based edge agent (runs on edge nodes).
- **`packages/shared-kernel`**: Shared TypeScript types and utilities.
- **`packages/ml-scheduler`**: TensorFlow.js based scheduling engine.
- **`packages/mock-agent`**: Node.js based agent for easy local testing.

---

## 🧪 Running Tests

We use Vitest for all TypeScript testing.

### Unit & Integration Tests

```bash
pnpm test          # Run all unit tests
pnpm test:integration # Run integration tests (requires infra)
```

### End-to-End Tests

```bash
pnpm test:smoke    # Run smoke tests
```

### Load Tests

```bash
pnpm test:load     # Run k6 load tests
```

---

## 🛠 Common Workflows

### Adding a New API Endpoint

1. Define the Zod schema for request/response in `apps/api/src/schemas/`.
2. Create the route handler in `apps/api/src/routes/`.
3. Register the route in `apps/api/src/index.ts`.
4. Update the OpenAPI spec: `pnpm --filter @edgecloud/api gen:openapi`.

### Adding a New Database Model

1. Edit `apps/api/prisma/schema.prisma`.
2. Generate the migration: `pnpm --filter @edgecloud/api migrate`.
3. Update the seed script in `apps/api/src/database/seed.ts` if needed.

---

## 💅 Code Style

- **Linting**: We use ESLint. Run `pnpm lint`.
- **Formatting**: We use Prettier. Run `pnpm format:write`.
- Both are enforced via Husky pre-commit hooks.

---

## 🐞 Debugging

### VSCode Launch Configurations

Open the **Run and Debug** side bar in VSCode to find pre-configured launch targets for the API and Web applications.

### Log Levels

Adjust log levels via the `LOG_LEVEL` environment variable in your `.env` file:

- `debug`, `info`, `warn`, `error`

---

## 🚢 Pull Request Process

1. Create a branch: `git checkout -b feat/your-feature`.
2. Ensure all tests pass: `pnpm test:all`.
3. Commit using conventional commits: `feat: add something awesome`.
4. Open a PR and wait for review.
5. CI must pass (Lint, Typecheck, Tests) before merging.
