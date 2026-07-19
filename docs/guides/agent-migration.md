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

1. **Native Execution Context**: The agent runs as a native compiled Rust daemon or as a Node service on the edge host, establishing direct outbound mTLS connections to the central orchestrator gateway.
2. **Environment Variables**:
   - Added `IMAGE_ALLOWLIST_REGEX` to prevent arbitrary image execution (e.g. `.*latest.*` is strictly forbidden).
   - Added `SANDBOX_ROOT_DIR` for configuring volume mounts safely.
   - Replaced `ENABLE_MTLS=false` with strict internal verification routines.

## Upgrading

If you are running the legacy `server.js` agent:

1. Shut down the legacy service (`pm2 stop edge-agent` or `docker stop edge-agent`).
2. Delete the old directory: `rm -rf edge-agent/`.
3. Configure the new agent using the environment variables and run it directly as a systemd service or container on the edge node.
4. Ensure the host node has the Docker socket mounted (`/var/run/docker.sock`) if running in a container.

## Testing

The new agent logic is comprehensively validated via `tests/integration/agent-task.test.ts`.
