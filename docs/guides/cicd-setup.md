# CI/CD and Deployment Setup Guide

This document outlines the pipeline and deployment model for the Edge-Cloud Orchestrator.

## Pipeline Architecture

The system uses a continuous integration and deployment model with the following components:

1.  **CI (GitHub Actions)**: `ci.yml`
    - Triggered on PRs and pushes to `main`.
    - Parallelized: Lint, Typecheck, Unit Tests, Integration Tests.
    - Security: Dependency audit and image scanning (Trivy).
    - Validation: Builds all Dockerfiles to catch build errors early.

2.  **CD (GitHub Actions)**: `cd.yml`
    - Triggered on push to `main` (only after CI passes).
    - Builds and pushes production images to GHCR (Tagged with SHA).

3.  **Deployment (Railway)**:
    - Automatically deploys the API monolith and API Gateway from GitHub pushes once the builds complete.
    - Handles continuous delivery, database management, and service orchestration natively.

## Prerequisites

- **Railway Dashboard Secrets**:
  - `DATABASE_URL`: PostgreSQL connection string.
  - `REDIS_URL`: Redis connection string.
  - `JWT_SECRET`: Secret key for authentication.
  - `SSL_SERVER_CERT`: Base64 wildcard/domain server certificate for mTLS negotiation.
  - `SSL_SERVER_KEY`: Base64 server private key for mTLS negotiation.

## Local Testing

You can run the smoke tests locally against a target URL:

```bash
env SMOKE_BASE_URL=http://localhost:3090 SMOKE_API_KEY=your-key pnpm run test:smoke
```

And load tests using Docker Compose:

```bash
docker-compose -f docker-compose.k6.yml up load-test
```
