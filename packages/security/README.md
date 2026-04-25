# @edgecloud/security

## Purpose

RBAC/ABAC authorization engine, mTLS certificate management, JWT utilities, and HashiCorp Vault client. Used by the API service and any service that needs to verify caller identity or rotate secrets.

## Installation

```sh
pnpm add @edgecloud/security
```

## Exports

| Export        | Type     | Description                                  |
|---------------|----------|----------------------------------------------|
| `AbacEngine`  | class    | Attribute-based access control evaluator     |
| `RbacEngine`  | class    | Role-based access control evaluator          |
| `VaultClient` | class    | HashiCorp Vault secret/PKI operations        |
| `MtlsManager` | class    | mTLS certificate generation and rotation     |
| `JwtUtils`    | object   | JWT sign/verify helpers                      |

## Usage

```typescript
import { AbacEngine, VaultClient } from '@edgecloud/security'

const abac = new AbacEngine()
const allowed = abac.evaluate({ subject: user, action: 'task:create', resource: task })

const vault = new VaultClient({ addr: process.env.VAULT_ADDR!, token: process.env.VAULT_TOKEN! })
const secret = await vault.readSecret('secret/db-password')
```

## Build

```sh
pnpm build   # tsc → dist/
pnpm test
```
