# AI Assistant Instructions - Edge-Cloud Orchestrator

This file contains mandatory instructions for any AI assistant or agent working on this project. These rules must be followed regardless of the length of time between sessions.

## 1. The Chronicle Protocol (CRITICAL)
- **Rule**: Every single technical update, architectural shift, bug fix, or feature addition **must** be logged in [CHRONICLE.md](file:///d:/Projects/Cloud1/edge-cloud-orchestrator/CHRONICLE.md) before the task is marked as completed.
- **Goal**: Maintain a clear, date-wise audit trail of the project's evolution over its multi-month development lifecycle.
- **Pre-Execution Check**: Before starting any task, read the latest entries in `CHRONICLE.md` to understand the current technical context and "baseline" state.

## 2. Shared Kernel First
- **Rule**: Any change to shared types, constants, or core domain logic must be implemented in the `shared-kernel` package first and then propagated to the services.
- **Rationale**: Maintain strict consistency between the control plane and edge agents.

## 3. Communication Standardization
- **Rule**: Prefer Redis Pub/Sub for low-latency real-time updates (e.g., heartbeats) and Kafka for reliable, persistent event sourcing (e.g., task status history).

---
*Authorized by USER on April 14, 2026*
