# CI/CD and GitOps Setup Guide

This document outlines the architecture and setup process for the Edge-Cloud Orchestrator delivery pipeline.

## Pipeline Architecture

The system uses a **GitOps** model with the following components:

1.  **CI (GitHub Actions)**: `ci.yml`
    - Triggered on PRs and pushes to `main`.
    - Parallelized: Lint, Typecheck, Unit Tests, Integration Tests.
    - Security: Dependency audit and image scanning (Trivy).
    - Validation: Builds all Dockerfiles to catch build errors early.

2.  **CD (GitHub Actions)**: `cd.yml`
    - Triggered on push to `main` (only after CI passes).
    - Builds and pushes production images to GHCR (Tagged with SHA).
    - Updates Kustomize overlays (Staging/Production) with the new image tags.
    - Verifies staging with smoke tests.
    - Enforces manual approval for production.

3.  **GitOps (ArgoCD)**:
    - Monitors the `infra/k8s/overlays/` paths in the repository.
    - Automatically syncs staging environment.
    - Manually syncs production environment (triggered by CD).

## Prerequisites

- **GitHub Secrets**:
  - `STAGING_API_URL`: Base URL for staging smoke tests.
  - `STAGING_API_KEY`: API Key for auth in smoke tests.
  - `ARGOCD_SERVER`: URL of your ArgoCD server.
  - `ARGOCD_AUTH_TOKEN`: Token for ArgoCD API access.
- **Kubernetes Secrets** (Must be in cluster):
  - `ghcr-credentials`: Image pull secret for GHCR.
  - `edgecloud-secrets`: Contains `DATABASE_URL`, `REDIS_URL`, `VAULT_TOKEN`, etc.

## Setup Instructions

### 1. Configure GitHub Environments

Go to **Settings > Environments** in your GitHub repo and create a `production` environment. Add any required protection rules (like manual approvers).

### 2. Install ArgoCD Applications

Apply the ArgoCD manifests to your cluster (assumes ArgoCD is already installed in the `argocd` namespace):

```bash
kubectl apply -f infra/k8s/argocd/staging-app.yaml
kubectl apply -f infra/k8s/argocd/production-app.yaml
```

### 3. Local Testing

You can run the smoke tests locally against a target URL:

```bash
env SMOKE_BASE_URL=http://your-staging.com SMOKE_API_KEY=your-key pnpm run test:smoke
```

And load tests using Docker Compose:

```bash
docker-compose -f docker-compose.k6.yml up load-test
```

## Maintenance

- **Adding a new service**:
  - Add a Dockerfile in `apps/<service>/Dockerfile`.
  - Add the service to the `matrix` in both `ci.yml` and `cd.yml`.
  - Create the base K8s Deployment/Service in `infra/k8s/base/`.
  - Add the new resource to `infra/k8s/base/kustomization.yaml`.
- **Scaling**: Update `infra/k8s/base/hpa/autoscalers.yaml` or replicas in overlays.
