# Configuration Guide

The Edge-Cloud Orchestrator uses environment variables for configuration across its services. This document outlines the required and optional variables for each application, along with best practices for managing secrets.

## Centralized Validation

Starting with v4.0.0, both the **API (Orchestrator)** and **Edge Agent** implement strict, type-safe environment validation using **Zod**.

- **Fail-Fast**: Services will immediately exit with a descriptive error if required variables are missing or malformed.
- **Type-Safety**: Environment variables are parsed into a type-safe `env` object, preventing runtime `undefined` errors.
- **No Direct Access**: Accessing `process.env` directly is deprecated. Always import `env` from the respective app's config module.

---

## Orchestrator API (`apps/api`)

### Core Settings

| Variable            | Description                                                  | Default        | Required |
| ------------------- | ------------------------------------------------------------ | -------------- | -------- |
| `NODE_ENV`          | Deployment environment (`development`, `test`, `production`) | `development`  | Yes      |
| `PORT`              | Listening port for the API                                   | `3090`         | No       |
| `DATABASE_URL`      | PostgreSQL connection string                                 | -              | Yes      |
| `DATABASE_READ_URL` | Read replica connection string                               | `DATABASE_URL` | No       |
| `REDIS_URL`         | Redis connection string                                      | -              | No       |

### Security

| Variable           | Description                               | Min Length |
| ------------------ | ----------------------------------------- | ---------- |
| `JWT_SECRET`       | Secret key for signing JSON Web Tokens    | 32 chars   |
| `ENCRYPTION_KEY`   | Key for encrypting sensitive fields in DB | 32 chars   |
| `MTLS_SERVER_CERT` | Path to server mTLS certificate           | -          |
| `MTLS_SERVER_KEY`  | Path to server mTLS key                   | -          |

### External Integrations

| Variable            | Description                                  |
| ------------------- | -------------------------------------------- |
| `GITHUB_TOKEN`      | Token for triggering ML retraining workflows |
| `ALERT_WEBHOOK_URL` | Webhook for sending system alerts            |

---

## Edge Agent (`apps/agent`)

### Node Identity

| Variable           | Description                     | Default | Required |
| ------------------ | ------------------------------- | ------- | -------- |
| `NODE_ID`          | Unique identifier for this node | -       | Yes      |
| `ORCHESTRATOR_URL` | URL of the Orchestrator API     | -       | Yes      |

### Communication Security

| Variable                   | Description                                     |
| -------------------------- | ----------------------------------------------- |
| `REQUEST_SIGNATURE_SECRET` | Shared secret for HMAC signing of task payloads |
| `ENABLE_MTLS`              | Enable mutual TLS for secure communication      |

---

## Secrets Management

### Local Development

For local development, copy the `.env.example` files to `.env` in the respective directories:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/agent/.env.example apps/agent/.env
```

### Production

In production, it is recommended to use a secure secret manager. The `SecretManager` abstraction supports:

1. **HashiCorp Vault**: Set `SECRET_BACKEND=vault` and provide `VAULT_ADDR` and `VAULT_TOKEN`.
2. **Kubernetes Secrets**: Set `SECRET_BACKEND=k8s` (automatic in K8s environments).
3. **Environment Variables**: Set `SECRET_BACKEND=env` (default).

> [!IMPORTANT]
> Even when using Vault or K8s, the startup validation ensures that all fetched secrets are valid before the application proceeds.

---

## Adding New Variables

To add a new environment variable:

1. Add it to the Zod schema in `apps/*/src/config/env.ts`.
2. Update the `.env.example` file.
3. Update this documentation.
4. Access it via the imported `env` object.
