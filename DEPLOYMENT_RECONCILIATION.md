# Deployment Reconciliation Report

Discovery date: 2026-07-17  
Context: reconciles `DEPLOYMENT_DISCOVERY.md` (K8s/ArgoCD conclusion) with the live Railway backend observed at `edge-cloud-orchestrator-production.up.railway.app`.

---

## Check 1: Railway config files in repo

**No `railway.json`, `railway.toml`, or `.env.railway` found anywhere in the repo.**

Railway does not require any repo-side config file. It can deploy purely via its dashboard integration (watch a GitHub repo, run a build command, deploy the resulting image). The absence of a config file does not mean Railway is not in use — it means Railway's configuration lives entirely on the Railway dashboard, not in source control.

---

## Check 2: GitHub Actions workflows referencing Railway

**Zero matches.** `git grep -rin "railway" -- .github/workflows/` returned nothing.

None of the five workflow files (`ci.yml`, `cd.yml`, `release.yml`, `ml-retrain.yml`, `security-scan.yml`) contain any Railway-specific steps, environment variables, or deployment targets. Railway is not wired into the GitHub Actions pipeline.

---

## Check 3: Railway dashboard integration (cannot be confirmed from repo)

**Needs dashboard check.**

Railway's GitHub App integration deploys automatically on push to a configured branch without any workflow file in the repo. Whether this is active can only be confirmed from the Railway dashboard (`railway.app/project/<id>/settings`). Based on the evidence below (Railway-specific Dockerfile fixes committed July 2), it is highly likely that Railway's GitHub integration is enabled and auto-deploying `apps/api` from the `main` branch.

---

## Check 4: Env files for Railway-managed service URLs

`apps/api/.env.production` (the file present in the repo) contains:
```
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/edgecloud
REDIS_URL=redis://redis:6379
```
These are Docker Compose service names — **not** Railway internal URLs.

Railway-managed databases use URLs of the form `postgresql://postgres:<password>@<random>.railway.internal:5432/<db>` or public Railway proxy URLs like `postgresql://postgres:<password>@roundhouse.proxy.rlwy.net:<port>/railway`. **No such URLs exist in any file in this repo.**

This means one of two things:
1. Railway environment variables (DATABASE_URL, REDIS_URL, JWT_SECRET, etc.) are injected directly through the Railway dashboard as service-linked variables — the correct pattern for Railway, and the most likely explanation. These would override the `.env.production` file at runtime.
2. The API on Railway is connecting to a database outside Railway (e.g. a separately provisioned Postgres).

In either case, the repo-side `.env.production` is not what Railway's live deployment is actually using — Railway injects its own env at build/runtime.

---

## Check 5: Git log for Railway-related commits — timeline

Three commits reference Railway directly, all on **2026-07-02**:

| SHA | Date | Message |
|-----|------|---------|
| `3236333` | Jul 2 13:37 | `fix: remove BuildKit cache mounts for Railway compatibility` |
| `b935381` | Jul 2 13:55 | `fix: use no-frozen-lockfile and pin pnpm version for Railway` |
| `1b84bba` | Jul 2 16:17 | `fix: pin pnpm version and disable frozen lockfile for Railway build` |

All three modify `apps/api/Dockerfile` to make it compatible with Railway's build environment (Railway doesn't support Docker BuildKit cache mounts; it also requires specific pnpm version pinning). These are iterative Railway-specific Dockerfile debugging commits — someone was actively getting the Railway deploy working on July 2, **two weeks before the K8s/ArgoCD infrastructure (`infra/k8s/`) was added** to the repo.

The K8s infrastructure (`infra/k8s/` with ArgoCD manifests, Kustomize overlays, Helm charts) was added later as aspirational or future architecture. It has no evidence of ever having been connected to a live cluster.

---

## Conclusion

### What platform is actually live

**Railway** is the live deployment platform. The backend at `edge-cloud-orchestrator-production.up.railway.app` is the real, active deployment. It has been running since early July 2 when Railway-specific Dockerfile fixes were committed. Railway's GitHub integration almost certainly auto-deploys `apps/api` on every push to `main` without any workflow file involvement.

### What the K8s/ArgoCD config is

**Aspirational / unused infrastructure.** The `infra/k8s/` directory, ArgoCD application manifests, Kustomize overlays, and Helm charts exist in the repo but there is no evidence any of them are connected to a live Kubernetes cluster. The `secrets.ARGOCD_SERVER` and `secrets.ARGOCD_AUTH_TOKEN` required by `cd.yml` and `release.yml` to actually trigger ArgoCD syncs are not verified as set. The `cd.yml` workflow's deploy step would fail silently or with a curl error if those secrets are empty. The K8s infrastructure was likely added as a forward-looking architectural target, not as the current operational path.

### What actually happens when you push to `main`

Two things potentially happen, in parallel, with different outcomes:

1. **GitHub Actions `cd.yml` triggers** — runs CI, builds Docker images, pushes to GHCR, then attempts to call ArgoCD API with `${{ secrets.ARGOCD_SERVER }}`. If that secret is unset, the curl command fails with an empty URL, and the deploy-to-staging step exits non-zero. Whether this fails the workflow or is treated as non-fatal depends on the exact shell behavior — the `curl` call has no `|| true` guard, so it would fail the job. **Net effect: the GitHub Actions deploy step fails, but the image is already pushed to GHCR.**

2. **Railway's GitHub App integration triggers** (if enabled on the dashboard) — Railway pulls the latest `main`, runs the Dockerfile for `apps/api`, and deploys the new container to the live Railway service. **This is what actually puts code into production.** It happens outside GitHub Actions entirely.

The live Railway deployment is decoupled from the GitHub Actions CD pipeline. Pushing to `main` currently means: Railway deploys it; GitHub Actions may or may not fail at the ArgoCD step depending on secret state.

### Critical implication

**Pushing to `main` currently deploys directly to the live Railway production environment with no staging gate.** There is no confirmed staging environment on Railway — the staging described in `cd.yml` references a Kubernetes namespace that may not exist. If Railway's auto-deploy is configured on `main`, every commit merged to `main` goes live immediately.
