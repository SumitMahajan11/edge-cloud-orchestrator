# infra/experimental/

This directory contains **future-roadmap and non-production infrastructure** that is intentionally excluded from all ArgoCD sync paths.

> **IMPORTANT:** Nothing in this directory is applied to staging or production.
> ArgoCD Applications point exclusively to `infra/k8s/overlays/{staging,production}`.

---

## Contents

### multi-region/
Federation configs for future multi-region deployment. Not applied to production.

- `k8s-multi-region.yaml` — Kubernetes Deployments, Services, and global Ingress for us-east, us-west, eu-west, ap-south regions. References CockroachDB regional topology and Redis Streams per-region brokers.
- `docker-compose.region.yml` — Local simulation of a multi-region topology for development testing.

**Roadmap target:** Q3–Q4 (see docs/decisions/ for multi-region ADR).

### chaos/
Chaos Mesh operator experiment definitions for resilience testing. Not applied to production.

- `chaos-experiments.yaml` — Chaos Mesh `PodChaos`, `NetworkChaos`, `StressChaos`, and `Schedule` resources. Requires [Chaos Mesh](https://chaos-mesh.org/) installed in the target cluster.

**Usage:** Apply manually to a dedicated test cluster only:
```bash
kubectl apply -f infra/experimental/chaos/chaos-experiments.yaml -n edgecloud
```
Do NOT add this path to any ArgoCD Application manifest.

---

## Adding New Experimental Configs

1. Create a subdirectory: `infra/experimental/<feature>/`
2. Add a section to this README describing: what it does, what it depends on, and what roadmap item it tracks.
3. Confirm the new path is NOT referenced in `infra/k8s/argocd/production-app.yaml` or `staging-app.yaml`.
