# ADR 003: Standardization on Kustomize and ArgoCD for Deployment

## Status
Accepted

## Context
The Edge-Cloud Orchestrator previously maintained two Kubernetes deployment strategies:
1. `infra/k8s/`: A Kustomize-based approach using overlays for environment-specific configurations (staging, production).
2. `infra/helm/`: A Helm-based chart for the orchestrator services.

Maintaining both strategies introduced configuration drift, increased the complexity of CI/CD pipelines, and created ambiguity regarding the "source of truth" for cluster state. ArgoCD was already partially integrated with the Kustomize structure.

## Decision
We will standardize on **Kustomize + ArgoCD** as the primary deployment strategy and decommission the Helm chart.

Kustomize was chosen because:
- It provides a native, template-free way to customize Kubernetes manifests via overlays.
- It aligns perfectly with GitOps principles when paired with ArgoCD.
- It avoids the complexity of Helm's templating engine (Go templates) for a project where YAML overlays are sufficient.
- It allows for easier auditing of resource differences between environments.

## Consequences
- The `infra/helm/` directory has been removed.
- All Kubernetes resources are now managed in `infra/k8s/base/` with environment-specific overrides in `infra/k8s/overlays/`.
- ArgoCD Application manifests in `infra/k8s/argocd/` are the definitive entry points for environment deployments.
- CI/CD pipelines will now use `kustomize edit set image` to update image tags instead of `helm upgrade --set`.

## Helm-to-Kustomize Gap Analysis & Migration

| Resource | Helm Status | Kustomize Status | Migration Action |
| :--- | :--- | :--- | :--- |
| **Ingress** | In `templates/ingress.yaml` | Missing from base | Ported to `base/ingress/edgecloud-ingress.yaml` |
| **ServiceAccount** | In `templates/serviceaccount.yaml` | Missing from base | Ported to `base/serviceaccounts/edgecloud-sa.yaml` |
| **NetworkPolicy** | Defined in `values.yaml` | Missing from base | Ported to `base/network-policies/edgecloud-np.yaml` |
| **ResourceQuotas** | Defined in `values.yaml` | Missing from base | Ported to `base/quotas/edgecloud-quota.yaml` |
| **PriorityClass** | Defined in `values.yaml` | Missing from base | Ported to `base/priority-classes/high-priority.yaml` |
| **Deployments** | Only Task Service in Helm | All 6 core services present | Unified in `base/deployments/` |

## Verification
Verification was performed using `kubectl kustomize infra/k8s/overlays/staging`, confirming the generation of a complete manifest including:
- 6 Microservice Deployments
- Internal and external Services
- API Gateway Ingress
- Scaling (HPA) and Reliability (PDB) resources
- Security and Governance resources (NetworkPolicy, Quotas, ServiceAccount)
