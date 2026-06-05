# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Removed

- **apps/web-legacy**: Deleted the deprecated legacy React application (fully superseded by Next.js `apps/web`) to eliminate 148 security vulnerabilities (including 12 critical issues) and streamline the monorepo workspace dependencies.

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
