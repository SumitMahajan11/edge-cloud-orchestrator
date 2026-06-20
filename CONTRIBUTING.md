# Contributing to Edge-Cloud Orchestrator

Thank you for your interest in contributing to the Edge-Cloud Orchestrator! This document provides a complete guide to setting up your local environment, understanding our development workflow, adhering to code quality standards, and submitting pull requests.

---

## 🚀 Quick Start (5-Minute Dev Setup)

Follow these steps to get your local development environment up and running:

### 1. Prerequisites
Ensure you have the following installed on your system:
- **Node.js**: v20+ (LTS recommended)
- **pnpm**: v9+ (for monorepo package management)
- **Rust**: stable toolchain (for agent development)
- **Docker Desktop**: (to run local databases and Kafka brokers)

### 2. Initial Setup
Clone the repository and install the monorepo dependencies:
```bash
git clone https://github.com/SumitMahajan11/edge-cloud-orchestrator
cd edge-cloud-orchestrator
pnpm install
```

### 3. Environment Variables
Copy the API environment template to configure database connections, port bindings, and keys:
```bash
cp apps/api/.env.example apps/api/.env
```
*Note: Key variables include `DATABASE_URL` (PostgreSQL connection string), `REDIS_URL` (Redis connection string), `JWT_SECRET` (secret key for signing JWT tokens), and `ENCRYPTION_KEY` (32-character key for data encryption).*

### 4. Running Infrastructure Dependencies
Spin up the local containerized stack (PostgreSQL 16, Redis 7, Kafka):
```bash
docker compose -f infra/docker/docker-compose.dev.yml up -d
```

### 5. Running Database Migrations
Initialize your local database schema with Prisma:
```bash
pnpm --filter @edgecloud/api exec prisma migrate dev
```

### 6. Starting Dev Servers
Launch the API control plane and the frontend web dashboard concurrently:
```bash
# Start API
pnpm --filter @edgecloud/api dev

# Start Frontend Dashboard (Web)
pnpm --filter @edgecloud/web dev
```

---

## 🧪 Running Tests

Always run the full test suite locally before pushing your changes:

- **Unit Tests**: `pnpm test`
- **Contract Tests**: `npx vitest run --project contract` (validates OpenAPI specs match implementation)
- **Integration Tests**: `npx vitest run tests/integration/`
- **E2E Tests**: `npx vitest run tests/e2e/`
- **Rust Agent Tests**:
  ```bash
  cd apps/agent
  cargo test
  ```
- **Monorepo-wide Verification**: `pnpm test:all`

---

## 📐 Code Standards & Architecture

To maintain code hygiene and a clean modular design:

### 1. TypeScript & Linting
- TypeScript strict mode must be enabled. No `as any` type-casts are permitted.
- Run ESLint to check for stylistic errors: `pnpm lint`.
- Verify TypeScript compilation: `pnpm typecheck`.

### 2. Monorepo Dependency Rules
- **No cross-app imports**: Never import directly between components in `apps/` (e.g. `apps/api` should never import from `apps/agent`).
- All shared utilities, types, and logic must reside inside modular workspace libraries inside `packages/` (e.g. `@edgecloud/shared-kernel`, `@edgecloud/security`).

### 3. Structured Logging
- Use the Pino logger for all control-plane code.
- Always provide contextual objects as the first argument, followed by a clear message string:
  ```typescript
  logger.info({ taskId: task.id, tenantId: tenant.id }, 'Successfully scheduled task');
  ```

### 4. Scaffolding a New Package
If you need to add a new library package to the monorepo:
1. Create the package directory: `mkdir packages/my-package`
2. Copy `packages/shared-kernel/package.json` to use as a template.
3. Update the `name` field to `@edgecloud/my-package`.
4. Register the directory path in the root `pnpm-workspace.yaml`.
5. Run `pnpm install` in the root to link the workspace package.
6. Create a local `tsconfig.json` that extends `../../tsconfig.base.json`.

---

## 🛡️ Pull Request & Branch Protection Rules

We enforce strict branch protection on `main` to safeguard the codebase:

### 1. Branch Naming Convention
- Features: `feature/short-description`
- Bug Fixes: `fix/short-description`
- Chores/Refactoring: `chore/short-description`

### 2. Commit Message Rules
We follow the **Conventional Commits** specification:
- `feat: add carbon intensity endpoint`
- `fix: correct broadcastToTenant argument order`
- `docs: improve contributing guidelines`
- `chore: update pnpm lockfile`

### 3. PR Checks & Gating
Before a Pull Request can be merged into `main`, it must satisfy the following:
- **Continuous Integration (CI)**: Linting, typecheck, and all test suites must pass (with 80%+ coverage).
- **Dependency Cruiser Validation**: No architectural or upward dependency violations are permitted (run `npx depcruise --config .dependency-cruiser.js packages apps` to verify).
- **Signed Commits**: All commits must be GPG-signed to verify the author's identity.
- **Maintainer Review**: At least one approved review from an architectural maintainer is required.

---

## 🔒 Security Scanning & Secret Prevention

Our CI/CD pipeline automatically executes the following tools on every commit:
- **Trivy**: Scans container images for vulnerabilities.
- **Semgrep**: Static analysis to identify insecure coding patterns.
- **Gitleaks**: Scans commits for accidentally exposed secrets.
- **OWASP Dependency Check**: Audits third-party dependency vulnerabilities (`pnpm audit` must have zero high/critical issues).

### What Must Never Be Committed:
- `.env` files or credentials.
- `coverage/` or test output artifacts.
- Build target outputs (`dist/`, `target/`, `target_clippy/`).
- Temporary files, log files (`*.log`), or personal scratch files.
