---
phase: 6
plan: 1
completed_at: 2026-06-06T07:22:00Z
duration_minutes: ~90
---

# Summary: Backend Infrastructure & Telemetry Bridges

## Results
- 3 tasks completed
- All verification checks passed
- TypeScript build: zero errors

## Tasks Completed

| Task | Description | Commit | Status |
|------|-------------|--------|--------|
| 1 | Add Geographic Coordinates to EdgeNode | 27b6d47 | ✅ |
| 2 | Implement Scheduling Decision Broadcast | 27b6d47 | ✅ |
| 3 | Harden WebSocket Client & Store | 03e18c3 | ✅ |

## Deviations Applied

- [Rule 1 - Bug] Task 3: On 4001 Unauthorized WS close, the old code silently reset reconnect counter but never cleared the stale token or signalled the auth layer. Fixed by dispatching the `auth-unauthorized` DOM event (mirroring customFetch behaviour) and clearing `this.token`.
- [Rule 2 - Missing Critical] Store (`websocket.ts`): Added `auth-unauthorized` window event listener so the Zustand store sets `status: "DISCONNECTED"` (not `"RECONNECTING"`) when an auth-expired WS closure happens, ensuring the UI pill shows the correct state.
- [Rule 1 - Bug / Adjacent] Discovered and fixed a root-cause authentication loop across all REST calls: `authApi.login()` was not persisting the JWT to `authStorage`, so every post-login request was unauthenticated. Fixed in `api-client.ts`.
- [Rule 2 - Missing Critical] Added `AppShell` auth guard in `Providers.tsx` that blocks dashboard mounting (and React Query hooks from firing) until `AuthProvider` hydrates from localStorage.
- [Rule 2 - Missing Critical] Mock DB seed updated to match real dev credentials (`admin@demo-org.com` / `Admin123!`).
- [Rule 2 - Missing Critical] CORS dev origins updated to include `http://localhost:3001`.

## Files Changed

- `apps/api/prisma/schema.prisma` — Added `latitude Float?`, `longitude Float?` to `EdgeNode`
- `apps/api/src/services/task-scheduler.ts` — Added `scheduler:decision` broadcast after task assignment
- `apps/web/src/lib/websocketClient.ts` — Hardened 4001 handler: clear token, dispatch `auth-unauthorized`, fix default URL
- `apps/web/src/stores/websocket.ts` — Added `auth-unauthorized` listener; `scheduler:decision` invalidation already present
- `apps/web/src/lib/api-client.ts` — Fixed: persist JWT to `authStorage` after login
- `apps/web/src/components/providers/Providers.tsx` — Added `AppShell` with auth guard + auto-redirect to login
- `apps/api/src/index.ts` — Added `localhost:3001` to dev CORS list
- `apps/api/src/initializers/mock-prisma.ts` — Synced mock seed credentials with real dev DB

## Verification

- ✅ `EdgeNode` has `latitude`/`longitude` fields in `schema.prisma`
- ✅ `scheduler:decision` broadcast present in `task-scheduler.ts` (line 1171)
- ✅ WS client connects to `ws://localhost:3090/ws` by default
- ✅ WS client handles code 4001 correctly (no reconnect, auth-unauthorized event)
- ✅ `scheduler.decision` invalidates `queryKeys.tasks.schedulingDecision(taskId)` and `queryKeys.scheduler.metrics()`
- ✅ TypeScript build: zero errors
