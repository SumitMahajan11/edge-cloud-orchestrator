# Contributing to Edge-Cloud Orchestrator

## Prerequisites
- Node.js 20+
- pnpm 9+
- Rust stable toolchain
- Docker Desktop
- PostgreSQL 15+ (or use Docker Compose)
- Redis 7+ (or Docker Compose)

## Getting started
1. **Clone**:
   ```bash
   git clone https://github.com/SumitMahajan11/edge-cloud-orchestrator
   ```
2. **Install**:
   ```bash
   pnpm install
   ```
3. **Copy env**:
   ```bash
   cp apps/api/.env.example apps/api/.env
   ```
   *Note: Key variables include `DATABASE_URL` (PostgreSQL connection string), `REDIS_URL` (Redis connection string), `JWT_SECRET` (secret key for signing JWT tokens), and `ENCRYPTION_KEY` (32-character key for data encryption).*
4. **Start deps**:
   ```bash
   docker compose -f infra/docker/docker-compose.dev.yml up -d
   ```
5. **Run migrations**:
   ```bash
   pnpm --filter @edgecloud/api exec prisma migrate dev
   ```
6. **Start API**:
   ```bash
   pnpm --filter @edgecloud/api dev
   ```
7. **Start web**:
   ```bash
   pnpm --filter @edgecloud/web dev
   ```

## Running tests
- **Unit**: `pnpm test`
- **Contract**: `npx vitest run --project contract`
- **E2E**: `npx vitest run tests/e2e/`
- **Integration**: `npx vitest run tests/integration/`
- **Rust agent**: `cd apps/agent && cargo test`

## Code standards
- TypeScript strict mode must be enabled; no `any` is allowed except for documented exceptions.
- **ESLint**: `pnpm lint` (must yield 0 problems before opening a PR).
- **TSC**: `pnpm typecheck` (must yield 0 source errors).
- **Pino logger**: always format logs as `logger.info({context}, 'message')` — with the context object as the first parameter.
- Never import directly between components in `apps/` — use modular code in `packages/` only.
- Never commit `.env` files, production secrets, `coverage/` outputs, `dist/` builds, or `*.log` files.

## Branch naming
- `feature/short-description`
- `fix/short-description`
- `chore/short-description`

## Commit messages
Follow Conventional Commits:
- `feat: add carbon intensity endpoint`
- `fix: correct broadcastToTenant argument order`
- `chore: update .gitignore`
- `docs: add v4.2.0 CHANGELOG entry`

## Pull request checklist
- [ ] pnpm lint passes (0 problems)
- [ ] pnpm typecheck passes (0 source errors)
- [ ] pnpm test passes (all suites)
- [ ] New feature has unit tests
- [ ] Security-relevant changes have security tests
- [ ] CHANGELOG.md updated if user-facing

## Adding a new workspace package
1. `mkdir packages/my-package`
2. Copy `packages/shared-kernel/package.json` to use as a template.
3. Set the name field to `@edgecloud/my-package`.
4. Add the directory to `pnpm-workspace.yaml`.
5. Run `pnpm install` to link the new workspace package.
6. Add a local `tsconfig.json` extending `../../tsconfig.base.json`.

## What must never be committed
- `.env` files or any file containing real secrets
- `coverage/`, `dist/`, `target/`, `target_clippy/`
- `*.log`, `*.tmp`, scratch files, AI session state
