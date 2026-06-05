# ADR 004 — Deploy via Kustomize Overlays with ArgoCD GitOps, not Helm

**Date:** 2026-04-25  
**Status:** Accepted  
**Category:** Deployment

## Context

Edge-Cloud Orchestrator requires Kubernetes deployment for:

- **Staging environment** — Auto-deploy from `main` branch for testing
- **Production environment** — Manual approval before deployment
- **Multiple services** — API, agent, scheduler, websocket-gateway, metrics
- **Environment-specific configuration** — Resource limits, replica counts, feature flags

Two primary approaches were evaluated:

### Helm

- Templating engine with Go templates
- Package management (charts, repositories)
- Values override system for environment customization
- Large ecosystem of community charts

### Kustomize + ArgoCD

- Declarative YAML patches (no templating DSL)
- Base configuration + environment overlays (staging, production)
- ArgoCD GitOps controller auto-syncs from Git
- Native Kubernetes tooling (built into kubectl since v1.14)

## Decision

**We use Kustomize overlays with ArgoCD for GitOps deployment.**

### Rationale

1. **Simpler Declarative Syntax**
   - Kustomize: Pure YAML patches (easy to read, diff, review)
   - Helm: Go templates (mixes logic with YAML, harder to debug)
   - Engineers can understand Kustomize without learning new DSL

2. **Git as Single Source of Truth**
   - All deployment configuration in Git repository
   - Complete audit trail (who changed what, when, why)
   - Rollback to any previous commit (instant, reliable)
   - No external chart repositories or package managers

3. **ArgoCD GitOps Automation**
   - Automatically detects changes in Git and syncs to cluster
   - **Staging**: Auto-sync on every `main` branch commit
   - **Production**: Manual approval required (safety gate)
   - Visual diff between Git state and cluster state
   - Health checks and automated rollback on failure

4. **No Custom DSL**
   - Kustomize uses standard Kubernetes YAML + `kustomization.yaml`
   - Helm requires learning Go template syntax, helper functions, chart structure
   - Lower cognitive overhead for onboarding

## Consequences

### Positive

- ✅ **Git Becomes Source of Truth** — Complete audit trail, instant rollback
- ✅ **Staging Auto-Syncs** — Automatic deployment when `main` updated (fast feedback)
- ✅ **Production Safety Gate** — Manual approval prevents accidental production changes
- ✅ **No Custom DSL** — Just Kubernetes YAML + `kustomization.yaml` (familiar syntax)
- ✅ **Better Code Reviews** — YAML patches are easier to review than template diffs
- ✅ **Native Tooling** — Built into kubectl, no additional dependencies

### Negative

- ⚠️ **Helm Charts Not Directly Usable** — Can't drop in community Helm charts (but Kustomize can reference Helm repos if needed)
- ⚠️ **Less Templating Power** — Can't generate resources programmatically (must list explicitly)
- ⚠️ **Larger YAML Files** — No loops or conditionals (must write out each resource)
- ⚠️ **ArgoCD Learning Curve** — Team must learn GitOps workflow, ArgoCD UI

## Directory Structure

```
infra/k8s/
├── base/                          # Shared configuration
│   ├── kustomization.yaml
│   ├── api-deployment.yaml
│   ├── agent-deployment.yaml
│   ├── scheduler-deployment.yaml
│   ├── postgres-statefulset.yaml
│   ├── redis-statefulset.yaml
│   └── services/
│       ├── api-service.yaml
│       └── agent-service.yaml
│
├── overlays/
│   ├── staging/                   # Staging overrides
│   │   ├── kustomization.yaml
│   │   ├── replicas-patch.yaml    # 1 replica
│   │   └── resources-patch.yaml   # Lower resource limits
│   │
│   └── production/                # Production overrides
│       ├── kustomization.yaml
│       ├── replicas-patch.yaml    # 3 replicas
│       └── resources-patch.yaml   # Higher resource limits
│
└── argocd/
    ├── applications/
    │   ├── staging-app.yaml       # Auto-sync enabled
    │   └── production-app.yaml    # Manual approval
    └── projects/
        └── edgecloud-project.yaml
```

## GitOps Workflow

### Staging (Auto-Sync)

```bash
# Developer merges PR to main
git checkout main
git merge feature-branch
git push origin main

# ArgoCD detects change within 3 minutes
# Automatically syncs staging environment
# Runs health checks
# Notifies Slack #deployments channel
```

### Production (Manual Approval)

```bash
# 1. ArgoCD detects change, marks production as "OutOfSync"
# 2. Engineer reviews diff in ArgoCD UI
# 3. Engineer clicks "Sync" after approval
# 4. ArgoCD applies changes to production
# 5. Health checks run, deployment verified
```

## Kustomize Example

### Base Configuration

```yaml
# infra/k8s/base/api-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: api
          image: api:latest
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
```

### Production Overlay

```yaml
# infra/k8s/overlays/production/replicas-patch.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 3
---
# infra/k8s/overlays/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
bases:
  - ../../base
patches:
  - path: replicas-patch.yaml
images:
  - name: api
    newTag: v1.2.3
```

## ArgoCD Application Definition

```yaml
# infra/k8s/argocd/applications/staging-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: edgecloud-staging
spec:
  project: edgecloud
  source:
    repoURL: https://github.com/org/edge-cloud-orchestrator.git
    targetRevision: main
    path: infra/k8s/overlays/staging
  destination:
    server: https://kubernetes.default.svc
    namespace: staging
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

## Mitigation Strategies

1. **Helm Chart Compatibility**
   - Use `helm template` to generate YAML, then Kustomize for customization
   - Reference external Helm repos in `kustomization.yaml` if needed

2. **Complex Templating**
   - For dynamic resource generation, use scripts to generate YAML before committing
   - Keep logic in CI/CD pipeline, not in deployment config

3. **ArgoCD Learning**
   - Provide team training on GitOps principles
   - Document common workflows (rollback, sync, diff)
   - Start with staging (low-risk) before production

## Revisit Triggers

This decision should be revisited when:

- Need to deploy community Helm charts without maintaining fork
- Deployment complexity requires programmatic resource generation
- Team prefers Helm's packaging and versioning model
- Multi-cluster deployment requires advanced fleet management (consider Fleet or Cluster API)

## Alternatives Considered

- **Helm + Helmfile** — More powerful templating, but Go templates harder to maintain
- **Pulumi** — Infrastructure as code in familiar languages, but vendor lock-in risk
- **Terraform + Kubernetes provider** — Good for infrastructure, overkill for app deployments
- **Raw kubectl + CI/CD** — Simple, but no GitOps automation, harder rollbacks

## References

- Kustomize Documentation: https://kustomize.io/
- ArgoCD Documentation: https://argo-cd.readthedocs.io/
- GitOps Principles: https://www.gitops.tech/
- Kustomize vs Helm: https://kubernetes.io/blog/2019/03/25/kubectl-kustomize/
