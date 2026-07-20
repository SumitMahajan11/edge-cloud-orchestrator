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

## 4. Verification & Commit Protocol

- **Rule**: Always ask and obtain explicit user approval before executing `git commit`. Do not assume approval.
- **Rule**: Always paste the literal, raw terminal output of commands (such as `git status`, test runners, or builds) in full as empirical evidence instead of asserting success or status in prose.

## 5. Fact Verification & Anti-Fabrication

- **Rule**: Never state a CVE/GHSA ID, changelog claim, or compatibility fact without it coming from an actual retrieved source in this session. If a specific advisory or version-pairing claim can't be found, say 'no specific advisory/pairing found' — do not produce a plausible-looking ID or number. Fabricating a citation is a more serious violation than admitting you don't know.

---

_Authorized by USER on July 19, 2026_
