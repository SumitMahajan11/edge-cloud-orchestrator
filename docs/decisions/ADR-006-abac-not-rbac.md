# ADR-006: Use ABAC (Attribute-Based Access Control) instead of simple RBAC
Date: 2026-06-11
Status: Accepted

## Context
The platform is multi-tenant. Different tenants have different node counts, task quotas, and feature access. Simple RBAC (admin/user/viewer) cannot express "tenant A can create 100 tasks/day but tenant B can create 500" or "user X can manage nodes only in region EU-WEST."

## Decision
ABAC with a Permissions array per user/role, evaluated at middleware layer. RolePermissions provides role-to-permissions fallback for backward compatibility.

## Consequences
+ Fine-grained access control expressible as data not code
+ New permissions added without code changes
+ Tenant-level resource quotas enforceable at auth layer
+ Compatible with standard JWT — permissions array in token payload
- More complex than RBAC to reason about for new contributors
- Permission explosion risk if permissions are too granular
- Requires RolePermissions maintenance when new roles are added
