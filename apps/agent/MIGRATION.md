# Migration Guide: `edge-agent` to `apps/agent`

## Overview

The legacy `edge-agent/server.js` JavaScript implementation has been officially deprecated and entirely replaced by the new canonical TypeScript agent located in `apps/agent/`. This document outlines the differences, ported features, and upgrade instructions.

## Gap Analysis & Ported Features

During the migration, a gap analysis was performed to ensure 100% feature parity. The following features were successfully ported from the legacy system:

- **Proactive Heartbeat Monitoring**: The legacy system used interval-based heartbeats. This was reimplemented in `apps/agent/src/index.ts` as a `HeartbeatSender` that polls system resource usage via `systeminformation` and pushes securely-signed updates to the Orchestrator.
- **Strict Sandbox Isolation**: The legacy system relied on basic Docker arguments. The new `DockerSandbox` implements hardened security features:
  - `MemorySwap` disabled
  - `CpuPeriod` explicitly set for hard limits
  - `PidsLimit` enforced (preventing fork bombs)
  - `Privileged: false` explicitly declared
- **Mandatory mTLS**: Optional TLS has been disabled. The new agent enforces mTLS with client certificate verification via the shared `packages/security/tls.ts` factory.
- **HMAC Payload Verification**: Added `x-signature` header validation to ensure that task execution requests actually originate from the Orchestrator.

## Deployment Changes

1. **Docker Execution Context**: The agent now uses a robust multi-stage Dockerfile located at `apps/agent/Dockerfile`.
2. **Kubernetes Integration**: Deployed as a `DaemonSet` (`infra/k8s/base/deployments/agent.yaml`) instead of a basic Pod, ensuring one agent runs natively on every edge node.
3. **Environment Variables**:
   - Added `IMAGE_ALLOWLIST_REGEX` to prevent arbitrary image execution (e.g. `.*latest.*` is strictly forbidden).
   - Added `SANDBOX_ROOT_DIR` for configuring volume mounts safely.
   - Replaced `ENABLE_MTLS=false` with strict internal verification routines.

## Upgrading

If you are running the legacy `server.js` agent:
1. Shut down the legacy service (`pm2 stop edge-agent` or `docker stop edge-agent`).
2. Delete the old directory: `rm -rf edge-agent/`.
3. Deploy using the new Kustomize manifest: `kubectl apply -k infra/k8s/base/`.
4. Ensure the host node has the Docker socket mounted (`/var/run/docker.sock`) properly mapped to the DaemonSet.

## Testing
The new agent logic is comprehensively validated via `tests/integration/agent-task.test.ts`.
