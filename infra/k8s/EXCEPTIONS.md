# Kubernetes Security Policy Exceptions

This document tracks and justifies deviations from the standard security hardening policies (non-root execution, read-only filesystem, restricted capabilities).

## 1. Edge Agent (DaemonSet)

| Exception                          | Justification                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runAsNonRoot: false`              | The agent requires access to the Docker socket (`/var/run/docker.sock`) to manage edge containers. On most hosts, the Docker socket is owned by root and requires root privileges or membership in the `docker` group, which is not easily portable across different edge node OS distributions without root. |
| `runAsUser: 0`                     | Same as above. Accessing the host Docker socket requires root privileges for deterministic operation across heterogeneous hardware.                                                                                                                                                                           |
| `capabilities.add: ["SYS_PTRACE"]` | Required for the agent to perform deep hardware inspection and process monitoring on edge nodes for telemetry.                                                                                                                                                                                                |

## 2. API Gateway (Nginx)

| Exception                      | Justification                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `readOnlyRootFilesystem: true` | (No Exception) Standard hardening applied.                                                    |
| `runAsUser: 101`               | Nginx image defaults to `101` (nginx) or `1001`. We use `1001` to match our service standard. |
