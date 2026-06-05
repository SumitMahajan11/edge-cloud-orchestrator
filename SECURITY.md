# Security Policy

## Supported Versions

We provide security updates for the following versions:

| Version | Supported |
| :------ | :-------- |
| v4.0.x  | ✅ Yes    |
| v3.x.x  | ❌ No     |
| v2.x.x  | ❌ No     |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability, please report it privately by:

1. Emailing `security@edgecloud-orchestrator.io` (monitored by the core team).
2. Or using the [GitHub Private Vulnerability Reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/about-private-vulnerability-reporting) feature if available on this repository.

We will acknowledge your report within 48 hours and provide a detailed response with next steps, including a timeline for a fix and public disclosure.

## Security Features

The Edge-Cloud Orchestrator is designed with a security-first mindset:

- **mTLS**: Mutual TLS is mandatory for all inter-service and node-to-cloud communication in production.
- **JWT + RBAC**: All API requests are authenticated via JWTs and authorized based on granular Role-Based Access Control.
- **Tenant Isolation**: Strict data isolation at the database (PostgreSQL RLS) and communication (namespaced WebSocket channels) layers.
- **SSRF Protection**: Request validation and egress filtering to prevent Server-Side Request Forgery.
- **Secrets Management**: Native integration with HashiCorp Vault for dynamic secret injection and PKI management.

## Known Limitations & Roadmap

- **Audit Logging**: While core actions are logged, full immutable audit trails (Write-Once-Read-Many) are planned for v4.1.0.
- **Sandbox**: Edge tasks currently run in Docker containers; support for gVisor or Firecracker microVMs is on the roadmap to improve multi-tenant isolation on nodes.
