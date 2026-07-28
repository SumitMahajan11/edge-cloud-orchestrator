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

## 6. Anti-Fabrication Rule

1. Never report something as "confirmed," "verified," or "working" unless it was actually tested — reading code and assuming it works is not the same as testing it. State clearly which one you did.
2. Always distinguish between:
   - "Confirmed via direct test/query" — you observed it happen.
   - "Inferred from code inspection" — you read the code and believe this is what it does, but didn't run it.
   - "Not confirmed / unknown" — you don't have evidence either way.
   Never upgrade an inferred or unknown claim to "confirmed" without actually testing it.
3. If a test used mocked data, fake credentials, or a local/non-production environment, say so explicitly in the result — don't present it as equivalent to testing the real thing.
4. If you can't access something needed to verify a claim (a production database, a credential, a service that's offline), say exactly what's missing and stop — don't work around it by testing a substitute and reporting it as if it answered the original question.
5. If you find evidence that contradicts an earlier claim (yours or the user's), report the contradiction directly. Do not quietly soften it, bury it, or omit it to keep the report looking clean.
6. When uncertain, say "unknown" or "unconfirmed" rather than guessing an explanation that sounds plausible.

---

_Authorized by USER on July 19, 2026_
