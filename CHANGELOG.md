# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [4.2.0] - 2026-05-31

### Added
- Shared test token factory with correct role-based permissions (DQ-4)
- LeaderElection mock utility for reliable test isolation (DQ-14)
- Server lifecycle test verifying clean startup and shutdown
- Production environment isolation helper for tests (DQ-5)
- E2E scheduling flow tests with real WebSocket connection verification

### Fixed
- broadcastToTenant argument order corrected across all route files;
  TenantId branded type prevents future argument swaps (DQ-3)
- Mock Prisma client aligned with real schema — all 15+ models stubbed,
  $queryRaw added, session→userSession naming fixed (DQ-2)
- Fastify decorator type declarations complete — all runtime decorators
  typed in fastify.d.ts (DQ-7)
- Background service lifecycle — all services stop cleanly on app.close()
  preventing test hangs (DQ-10)
- Integration test schema synced with main API schema (DQ-11)
- Pino logger argument order verified correct across all services (DQ-1)
- .gitignore rebuilt from clean UTF-8 encoding (was mixed UTF-8/UTF-16LE)
- Husky pre-commit script fixed to not exit 1 on clean commits
- Flaky ML scheduler test fixed (Math.random mock, getFeatureImportance stub)

### Removed
- apps/web-legacy: deprecated web client removed; all functionality
  available in apps/web
- docs/archive/: 62 historical documents removed from repository
- One-time patch scripts (patch-mtls.ps1, fix-mtls.ps1) removed from
  source tree after application

### Security
- Added pnpm audit gate to CI — fails build on critical CVEs
- All 148 vulnerabilities from web-legacy eliminated by removal

---

## [4.1.0] - 2026-05-15

### Added
- Contract testing suite: v2-api-contract, schema-drift, v1-deprecation
  tests (125 passing)
- OpenAPI v2 specification regenerated and synced between root and
  apps/api locations
- Shared-kernel exports: Permissions, validateWebhookUrl, DAGExecutor,
  WorkflowNode
- ABAC test fixes and role-to-permissions fallback in auth middleware
- Webhook idempotency implementation
- Rate limiter Redis fallback

### Fixed
- XGBoost references removed — ML backend correctly documented as
  TensorFlow.js 4-layer Keras model
- ML feedback loop closure implemented
- Tenant resource quotas enforced
- WebSocket JWT authentication hardened
- mTLS CA signature verification strengthened
- SSRF protection added to AlertingService

---

## [4.0.0] - 2026-04-29

### Added

- **API v2 Infrastructure**: Multi-version routing supported via `/v1/*` and `/v2/*`.
- **Automated MLOps Pipeline**:
  - Weekly retraining schedule via GitHub Actions.
  - Live feature drift detection triggering on-demand retraining.
  - Validation gates (P99 error < 10ms) for model promotion.
- **Distributed Tracing 2.0**:
  - End-to-end trace propagation from React frontend to Edge Agent.
  - OTel trace injection for fetch/XHR calls in the browser.
- **Scalable ML Storage**: S3-backed model weight storage, offloading large binary blobs from PostgreSQL.
- **Webhook Reliability**: Background `WebhookRetryJob` with exponential backoff for failed deliveries.

### Deprecated

- **API v1**: Now deprecated. Please migrate to v2.
  - v1 endpoints now return `Deprecation: true` and `Sunset` headers.
  - Sunset Date: October 2026.

### Fixed

- **Type Safety**: Removed `any` casts in `edgeNode.create` during registration; now strictly maps hardware resource fields.
- **Dead Code Cleanup**: Removed unused `setColdStartHandler` stubs in `TaskScheduler`.
- **Repository Hygiene**: Sanitized repository of build artifacts and updated `.gitignore` to prevent future leaks.

## [3.5.0] - 2026-04-18

- Consolidated technical documentation into the first "Ultimate Project Report".
- Hybrid folder structure optimization.
- Mermaid architectural diagrams added.

## [2.0.0] - 2026-04-15

- Consolidated `scheduler-service`, `node-service`, and `task-service` into the core `api` service.
