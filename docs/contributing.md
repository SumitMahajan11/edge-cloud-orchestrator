# Contributing to Edge-Cloud Orchestrator

Thank you for your interest in contributing! This document outlines our development process and architectural standards.

## Branching Strategy

- `main`: Production-ready code. No direct pushes allowed.
- `feature/*`: New features or enhancements.
- `fix/*`: Bug fixes.
- `hotfix/*`: Critical production fixes.

## CI/CD Pipeline & Branch Protection Rules

To maintain high code quality and security, we enforce the following **Branch Protection Rules** on the `main` branch:

### 1. Required Status Checks
All PRs must pass the following checks before they can be merged:
- **Continuous Integration (CI)**: Includes linting, type-checking, unit tests (with 80%+ coverage), and integration tests.
- **Contract Tests**: Ensures the OpenAPI spec is in sync with the implementation.
- **Dependency Cruiser**: Validates that no architectural violations (e.g., circular dependencies or upward flow) are introduced.
- **Security Audit**: `pnpm audit` must pass with zero high-severity vulnerabilities.

### 2. Required Reviews
- At least **one approved review** is required from a maintainer.
- Reviewers will check for adherence to the **Monorepo Dependency Architecture** (see `docs/ARCHITECTURE.md`).

### 3. Signed Commits
- All commits must be **GPG-signed** to verify the author's identity.

### 4. No Force Pushes
- Force pushing to `main` is strictly prohibited.

## Development Workflow

1. **Fork/Branch**: Create a new branch from `main`.
2. **Implement**: Write your code and tests.
3. **Local Validation**:
   ```bash
   pnpm run typecheck
   pnpm run lint
   pnpm run test
   npx depcruise --config .dependency-cruiser.js packages apps
   ```
4. **Commit**: Use [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat: add task migration`, `fix: resolve race condition`).
5. **PR**: Open a Pull Request against `main`.
6. **Merge**: Once CI passes and reviews are approved, use **Squash and Merge**.

## Security Scanning

Our pipeline automatically runs weekly and on every PR:
- **Trivy**: Scans Docker images for vulnerabilities.
- **Semgrep**: Static analysis for security patterns.
- **Gitleaks**: Scans for accidentally committed secrets.
- **OWASP Dependency Check**: Scans for known vulnerabilities in third-party libraries.
