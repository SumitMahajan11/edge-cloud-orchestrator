# Deployment Guide

## Prerequisites

Before deploying, verify each item is ready:

- [ ] Kubernetes cluster running (1.24+)
- [ ] `kubectl` configured to the target cluster
- [ ] ArgoCD installed:
  ```bash
  kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
  ```
- [ ] HashiCorp Vault running (with `pki/*` secrets engine enabled)
- [ ] Docker images pushed to GHCR (GitHub Container Registry)
- [ ] `.env` values loaded into Vault (no local `.env` files on cluster nodes)

---

## Environments

| Environment | Namespace | Auto-sync | Approval required |
|---|---|---|---|
| staging | `edgecloud-staging` | Yes | No |
| production | `edgecloud-production` | No | Yes (manual) |

---

## Deploy to Staging (automatic)

1. **Create the namespace**
   ```bash
   kubectl create namespace edgecloud-staging
   ```

2. **Create image pull secret**
   ```bash
   kubectl create secret docker-registry ghcr-credentials \
     --docker-server=ghcr.io \
     --docker-username=YOUR_USER \
     --docker-password=YOUR_PAT \
     -n edgecloud-staging
   ```

3. **Create database/redis secrets**
   ```bash
   kubectl create secret generic edgecloud-secrets \
     --from-literal=DATABASE_URL=postgresql://user:pass@host:5432/edgecloud \
     --from-literal=REDIS_URL=redis://host:6379 \
     --from-literal=JWT_SECRET=<min-32-char-secret> \
     -n edgecloud-staging
   ```

4. **Apply ArgoCD application**
   ```bash
   kubectl apply -f infra/k8s/argocd/staging-app.yaml
   ```

5. **Monitor sync**
   ```bash
   argocd app watch edgecloud-staging \
     --server ARGOCD_SERVER \
     --auth-token TOKEN \
     --grpc-web
   ```

6. **Verify**
   ```bash
   kubectl get pods -n edgecloud-staging
   # All pods should be in Running state
   ```

---

## Deploy to Production (manual approval)

Same sequence as staging, but with these additional steps:

1. **Update image tags** — edit `infra/k8s/overlays/production/kustomization.yaml` with the new image SHA from the build:
   ```yaml
   images:
     - name: ghcr.io/your-org/api
       newTag: sha-<COMMIT_SHA>
   ```

2. **Open a PR** with the updated image tag changes. Require at least one review before merge.

3. **After approval and merge:**
   ```bash
   git checkout main && git pull
   ```

4. **Trigger manual ArgoCD sync** (ArgoCD does NOT auto-sync production):
   ```bash
   argocd app sync edgecloud-production \
     --server ARGOCD_SERVER \
     --auth-token TOKEN \
     --grpc-web
   ```

5. **Wait for all pods to be Ready:**
   ```bash
   kubectl rollout status deployment --namespace edgecloud-production
   ```

6. **Run smoke tests against production** (see Verify Deployment below).

---

## Rollback

If a production deployment fails:

```bash
# List history to find the revision to roll back to
argocd app history edgecloud-production \
  --server ARGOCD_SERVER \
  --auth-token TOKEN \
  --grpc-web

# Roll back to a specific revision
argocd app rollback edgecloud-production <REVISION> \
  --server ARGOCD_SERVER \
  --auth-token TOKEN \
  --grpc-web
```

Kubernetes-native rollback (if ArgoCD is unavailable):
```bash
kubectl rollout undo deployment/api -n edgecloud-production
kubectl rollout undo deployment/task-service -n edgecloud-production
kubectl rollout undo deployment/scheduler-service -n edgecloud-production
```

---

## Verify Deployment

### Pod health
```bash
kubectl get pods -n edgecloud-staging
# Expected: all pods Running and Ready (e.g. 1/1 or 2/2)
```

### API readiness
```bash
kubectl port-forward -n edgecloud-staging svc/api 3000:3000
curl http://localhost:3000/health/ready
# Expected: HTTP 200
```

### Per-service health (ports 3000–3005)
| Service | Port |
|---|---|
| api | 3000 |
| task-service | 3001 |
| scheduler-service | 3003 |
| node-service | 3004 |
| websocket-gateway | 3002 |
| metrics-service | 3005 |

```bash
# Example for each service
kubectl port-forward -n edgecloud-staging svc/<service-name> <port>:<port>
curl http://localhost:<port>/health/ready
```

### Metrics endpoint
```bash
kubectl port-forward -n edgecloud-staging svc/metrics-service 3005:3005
curl http://localhost:3005/metrics
# Expected: Prometheus-format metrics text
```

### Log tailing
```bash
kubectl logs -n edgecloud-staging -l app.kubernetes.io/name=api -f
```

---

## ArgoCD Application Files

| File | Purpose |
|---|---|
| `infra/k8s/argocd/staging-app.yaml` | Staging ArgoCD Application (auto-sync) |
| `infra/k8s/argocd/production-app.yaml` | Production ArgoCD Application (manual sync) |
| `infra/k8s/overlays/staging/` | Staging Kustomize overlay |
| `infra/k8s/overlays/production/` | Production Kustomize overlay |

> **Note:** `infra/experimental/` is intentionally excluded from all ArgoCD sync paths. It contains Chaos Mesh CRDs and multi-region federation configs that are not part of the standard deployment.
