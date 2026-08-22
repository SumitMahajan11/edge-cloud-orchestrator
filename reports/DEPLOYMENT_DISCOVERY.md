# Deployment Discovery Report

Discovery date: 2026-07-17  
Branch: `main` (HEAD `66b7c8a`)

---

## Check 1: CI/CD Workflows

**Found:** `.github/workflows/` contains five files.

| File | Purpose |
|------|---------|
| `ci.yml` | Full CI pipeline — typecheck, lint, unit tests, migration gate, integration tests, contract tests, dep-graph check, build. Triggers on push/PR to `main` and weekly cron. |
| `cd.yml` | Continuous Delivery — triggers on push to `main`. Runs CI, then builds & pushes Docker images for `api`, `agent`, `web` to **GHCR** (`ghcr.io/SumitMahajan11/edge-cloud-orchestrator/<app>`), runs Trivy vulnerability scan, validates image sizes, then deploys to staging via ArgoCD API call. |
| `release.yml` | Triggers on `v*.*.*` tags. Runs full CI, creates GitHub Release with CHANGELOG, publishes shared packages to npm, then deploys to production via ArgoCD API call. |
| `ml-retrain.yml` | ML model retraining (unrelated to core deploy). |
| `security-scan.yml` | Standalone security audit (unrelated to core deploy). |

**No GitLab CI, no Jenkinsfile.**

---

## Check 2: Deploy Scripts and Docs

**Found:**

- `scripts/deploy.ps1` — A local PowerShell deploy script. Accepts `-Environment staging|production` parameter. For staging: builds Docker images locally and runs `docker-compose up`. For production: applies Kubernetes manifests via `kubectl`. Post-deployment verifies health endpoints at `localhost:3000–3004`. **This script targets localhost / a locally configured `kubectl` context — it is not a cloud deploy script.** It references paths like `./edge-cloud-orchestrator/apps/task-service` from a parent directory, suggesting it was written to be run from outside the repo root.

- `docs/DEPLOYMENT.md` — Documents the canonical deploy procedure. Requires: Kubernetes cluster (1.24+), ArgoCD installed, HashiCorp Vault with `pki/*` engine, Docker images already pushed to GHCR, and env values loaded into Vault (no local `.env` files on cluster nodes). Walks through staging (`edgecloud-staging` namespace, ArgoCD auto-sync) and production (`edgecloud-production` namespace, manual ArgoCD sync required).

**No `build:prod` or `deploy` scripts in root, `apps/api`, or `apps/web` `package.json`.** `apps/api` has `start: node dist/src/index.js` (production node start) and `migrate:deploy: prisma migrate deploy`. `apps/web` has standard Next.js `build` / `start`.

---

## Check 3: Platform Config Files

**Found:**

- **No `vercel.json`, `netlify.toml`, `fly.toml`, or `render.yaml`** — none of these PaaS platforms are in use.
- **Dockerfiles present:** `./Dockerfile` (root), `apps/agent/Dockerfile`, `apps/api/Dockerfile`, `apps/api-gateway/Dockerfile`, `apps/metrics-service/Dockerfile`, `apps/node-service/Dockerfile`, `apps/task-service/Dockerfile`, `apps/websocket-gateway/Dockerfile`. The CI/CD pipeline only builds `api`, `agent`, and `web`; the other Dockerfiles are present but not referenced by the active workflows.
- **No `docker-compose.prod.yml`** (checked naming variants). The production deploy goes through Kubernetes, not Docker Compose. Docker Compose is used for local dev and staging only (via `deploy.ps1`).
- **`infra/k8s/`** is fully populated: `base/` (Kustomize base manifests), `overlays/staging`, `overlays/production`, `argocd/staging-app.yaml`, `argocd/production-app.yaml`, `helm/`, `network-policies/`, HPA, PDB, ingress, external secrets, namespace manifests.

---

## Check 4: Environment Files

**Found:**

- `apps/api/.env.production` — Present in repo (not gitignored). Contains:
  ```
  HOST=0.0.0.0
  NODE_ENV=production
  DATABASE_URL=postgresql://postgres:postgres@postgres:5432/edgecloud
  REDIS_URL=redis://redis:6379
  ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
  ```
  `DATABASE_URL` hostname is `postgres` (Docker Compose service name) and `REDIS_URL` is `redis` (Docker Compose service name) — **these are container-internal DNS names, not real external hosts.** `ALLOWED_ORIGINS` is localhost only. This file is configured for Docker Compose / local production-mode runs, not a live cloud environment.

- `apps/api/.env`, `apps/api/.env.real`, `apps/api/.env.example`, `apps/api/.env.mock` — present; `.env.real` is the file used for local integration testing against `eco_postgres_real`.
- No env file contains a non-localhost `DATABASE_URL` or an `API_URL` pointing to a live host (e.g. `api.edgecloud.io`). All URLs are either `localhost`, Docker service names, or placeholder/example values.

---

## Check 5: Git Remotes and Branches

```
origin  https://ghp_...@github.com/SumitMahajan11/edge-cloud-orchestrator.git (fetch)
origin  https://ghp_...@github.com/SumitMahajan11/edge-cloud-orchestrator.git (push)
```

- **One remote:** `origin` → `github.com/SumitMahajan11/edge-cloud-orchestrator`
- **Local branches:** `main` (current), `backup-node-read-fix`
- **Remote branches:** `remotes/origin/main` only — `backup-node-read-fix` has never been pushed

The CD workflow triggers on push to `main`. The ArgoCD staging app watches `repoURL: https://github.com/SumitMahajan01/edge-cloud-orchestrator.git` at `targetRevision: main`. This means **pushing to `origin main` would trigger the full CD pipeline** if GitHub Actions is active on this repo.

---

## Check 6: ARCHITECTURE.md / README.md / CLEANUP.md

`ARCHITECTURE.md` describes the system architecture (API, Agent, WebSocket Gateway) and mentions "three main deployable applications" but contains no deployment-target specifics.  
No `README.md` or `CLEANUP.md` found at repo root with deployment content beyond what's in `docs/DEPLOYMENT.md`.

---

## Conclusion

**This project is set up for Kubernetes/ArgoCD deployment, triggered by GitHub Actions, with Docker images stored on GHCR.**

The intended path is:

1. **Staging (automatic):** Push to `main` → `cd.yml` runs CI → builds and pushes Docker images to GHCR → calls ArgoCD API to sync `edgecloud-staging` namespace on whatever Kubernetes cluster `secrets.ARGOCD_SERVER` points to.
2. **Production (manual gate):** Push a `v*.*.*` tag → `release.yml` runs → publishes npm packages → calls ArgoCD API to sync `edgecloud-production` namespace (ArgoCD `automated: null` means it requires a manual sync trigger).

**Critical gaps before any actual deploy can happen:**

| Blocker | Detail |
|---------|--------|
| No live Kubernetes cluster confirmed | `kubectl` context, cluster address, and credentials unknown locally |
| `secrets.ARGOCD_SERVER`, `secrets.ARGOCD_AUTH_TOKEN` not set | These GitHub Actions secrets are required for CD/release pipelines to reach ArgoCD; without them the deploy steps fail at the curl command |
| `secrets.STAGING_API_URL`, `secrets.STAGING_API_KEY` not set | Required by the smoke tests in `cd.yml` |
| `secrets.GRAFANA_URL`, `secrets.GRAFANA_TOKEN` not set | Required for deploy annotation step in `cd.yml` |
| `secrets.NPM_TOKEN` not set | Required for `release.yml` npm publish step |
| No live `DATABASE_URL` or `REDIS_URL` pointing to real hosts | All current env files use Docker service names or localhost |
| `infra/k8s/overlays/staging` and `overlays/production` kustomize content | Not verified that overlay images/patches are up-to-date |

**Locally, the fastest working "production-mode" run would be `docker-compose up` using `apps/api/.env.production`** — this runs the API against Docker service names, which is what the compose network resolves. This is not a real external deployment.

**No deploy can proceed against a real environment** until at minimum: a Kubernetes cluster exists, ArgoCD is running and configured on it, and the GitHub Actions secrets above are populated. The infrastructure config files (Dockerfiles, K8s manifests, ArgoCD app specs) are all present and well-structured — the gap is credentials/infrastructure, not missing config.
