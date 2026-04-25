# ADR-003: Standardizing Deployment via Kustomize and ArgoCD

**Status**: Accepted  
**Date**: 2026-04-19  
**Authors**: Engineering Team  

---

## Context

The project initially used **Helm** as the primary package manager for Kubernetes deployments. While Helm is powerful, it introduced several challenges for this specific project:
1. **Template Complexity**: Over-reliance on `.tpl` files made manifests difficult to debug.
2. **Values Proliferation**: `values.yaml` became a "catch-all" for configuration, leading to tight coupling between services.
3. **Drift Management**: Verifying the diff between what is in Git and what is running in the cluster was cumbersome.

## Decision

We have decided to **replace Helm with Kustomize** for manifest management and **ArgoCD** for deployment orchestration.

### Rationale

1. **Native Kubernetes**: Kustomize uses standard YAML and is built into `kubectl`, reducing external dependencies.
2. **Clear Overlays**: The `base/` and `overlays/` pattern allows for clean separation between production-grade configurations and environment-specific tweaks (e.g., staging resource limits).
3. **ArgoCD Integration**: ArgoCD handles Kustomize natively, allowing for "GitOps" workflows where the cluster state is automatically synchronized with the monorepo.
4. **Visibility**: Kustomize's "no-template" approach means what you see in the YAML is exactly what gets applied to the cluster (after overlays).

## Implementation Details

- **Base Directory**: `infra/k8s/base/` contains the "Gold Standard" manifests for all services.
- **Overlays**: `infra/k8s/overlays/staging/` and `infra/k8s/overlays/production/` handle environment-specific overrides.
- **Decommissioning**: `infra/helm/` has been removed to prevent "split-brain" deployment signals.

## Consequences

- **Helm Purge**: `infra/helm/` directory deleted.
- **Simplified CI/CD**: CI pipelines now only need to run `kubectl kustomize` to verify manifests.
- **Onboarding**: New contributors can read standard YAML without learning Helm's Go-template syntax.
