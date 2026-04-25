# Edge-Cloud Orchestrator API - Source Structure

This directory contains the core business logic and API implementation for the Edge-Cloud Orchestrator.

## Directory Standards

To maintain module boundaries and architectural integrity, the following directory structure is enforced:

| Directory | Purpose |
|-----------|---------|
| `architecture/` | Documentation and implementations of core patterns (e.g., Core vs Plugins). |
| `config/` | Environment-specific configurations and global settings. |
| `controllers/` | Request/Response handlers. Should remain thin, delegating to services. |
| `database/` | Prisma schemas, connection pooling, and database-specific utilities. |
| `initializers/` | Startup hooks, dependency injection setup, and service booting. |
| `lib/` | Reusable local libraries and wrappers for external SDKs. |
| `middleware/` | API middleware (auth, logging, error handling, rate limiting). |
| `plugins/` | Modular extensions that can be enabled/disabled at runtime. |
| `queries/` | Read-optimized data access logic (CQRS pattern). |
| `routes/` | Definition of API endpoints and mapping to controllers. |
| `sagas/` | Orchestration of complex, long-running distributed workflows. |
| `schemas/` | Validation logic and runtime type enforcement (Zod). |
| `services/` | Primary business logic layer. Modules should expose clean APIs here. |
| `types/` | Shared TypeScript interfaces and domain-specific types. |
| `utils/` | Stateless utility functions. |

## Module Boundary Rules

- **Internal Only**: Files within a subdirectory should not be imported directly from outside that subdirectory.
- **Export via Index**: Use `index.ts` to expose the public API of a module.
- **Dependency Flow**: Higher-level layers (routes, controllers) may import from lower-level layers (services, database), but not vice versa.
- **No Circular Deps**: Ensure clear hierarchical dependencies to prevent circular references.

---
*Last Updated: April 2026*
