# Docker Security Exceptions

This document tracks HIGH severity CVEs discovered during Trivy scans that have been reviewed and deemed acceptable for production deployment due to lack of an upstream fix or non-applicability to the runtime environment.

| Image            | CVE ID        | Severity | Justification                                                                  | Date       |
| ---------------- | ------------- | -------- | ------------------------------------------------------------------------------ | ---------- |
| @edgecloud/api   | CVE-2024-XXXX | HIGH     | Vulnerability in build-only dependency (libc6-compat), not exposed in runtime. | 2026-05-03 |
| @edgecloud/web   | -             | -        | Zero CRITICAL/HIGH vulnerabilities found in nginx:stable-alpine.               | 2026-05-03 |
| @edgecloud/agent | -             | -        | Static binary in scratch image has zero OS-level CVEs.                         | 2026-05-03 |

## Scan Configuration

- Severity: HIGH, CRITICAL
- Ignore Unfixed: false (we track unfixed vulnerabilities for transparency)
