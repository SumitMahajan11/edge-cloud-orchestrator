# Git Reset Damage Report

**Most of this is permanently lost and here's why:** The `git status` output before the reset clearly indicated that the modified files were "Changes not staged for commit", and the untracked files were, by definition, untracked. Because they were neither committed nor staged (added to the Git index), Git never created blob objects for them in its database. A `git reset --hard` overwrites the working tree for tracked files, and `git clean -fd` deletes untracked files directly from the filesystem. `git fsck --lost-found` can only recover orphaned blobs that were at least staged at some point. Therefore, every unstaged change and every untracked file listed below is permanently unrecoverable via Git.

## 1. The Full Picture of What Was Destroyed

Below is the complete list of files that were modified or untracked before the `git reset --hard` and `git clean -fd` were executed.

**Changes not staged for commit (Modifications lost):**
- .gitignore
- ARCHITECTURE.md
- CLEANUP.md
- FINAL-AUDIT-REPORT.md
- VERIFIED-AUDIT-REPORT.md
- apps/api/openapi-v2.yml
- apps/api/src/routes/policies.ts
- apps/api/src/routes/tasks.ts
- apps/api/src/routes/webhooks.ts
- apps/api/src/sagas/task-lifecycle-saga.ts
- apps/api/src/services/__tests__/task-scheduler.audit.spec.ts
- apps/api/src/services/heartbeat-monitor.ts
- apps/api/src/services/idempotency-service.ts
- apps/api/src/services/priority-scheduler.ts
- apps/api/src/services/task-scheduler.ts
- apps/api/tests/integration/zombie-task-recovery.test.ts
- apps/web/src/app/policies/page.tsx
- apps/web/src/app/scheduler/page.tsx
- apps/web/src/app/webhooks/page.tsx
- apps/web/src/app/workflows/page.tsx
- apps/web/src/components/modals/AddNodeModal.tsx
- apps/web/src/components/scheduler/TaskDetailDrawer.tsx
- apps/web/src/hooks/usePolicies.ts
- apps/web/src/hooks/useTasks.ts
- apps/web/src/hooks/useWorkflows.ts
- apps/web/src/lib/api-client.ts
- apps/web/src/lib/websocketClient.ts
- models/model_1.0.0.json
- models/model_1.0.1.json
- models/model_1.0.2.json
- models/model_metadata.json
- packages/api-client/src/index.ts
- packages/api-client/src/sdk.gen.ts
- packages/api-client/src/types.gen.ts
- packages/api-client/src/zod.gen.ts
- tests/e2e/scheduling-flow.test.ts
- tests/integration/helpers.ts
- tests/integration/infrastructure.test.ts
- tests/integration/saga-flow.test.ts
- tests/integration/scheduling-race-condition.test.ts
- tests/smoke/results/smoke-results.json
- vitest.workspace.ts

**Untracked files (Deleted):**
- RECONCILIATION_REPORT.md
- actual_paths.json
- alerts_resp.json
- apikeys_resp.json
- apps/api/src/database/check-task.ts
- apps/api/src/database/query-nodes.ts
- apps/api/src/database/reset-ca.ts
- apps/api/src/database/send-heartbeat.ts
- apps/api/src/database/test-force-execute.ts
- apps/api/src/database/test-policies-api.ts
- apps/api/src/database/test-scheduler-api.ts
- apps/web/src/components/modals/GlobalConfigModal.tsx
- apps/web/src/components/modals/PolicyModal.tsx
- apps/web/src/hooks/useScheduler.ts
- apps/web/src/lib/__tests__/token-refresh.test.ts
- audit_probe.bat
- audit_probe_v2.bat
- audit_resp.json
- carbon_get.json
- carbon_patch.json
- carbon_resp.json
- compliance_resp.json
- curl_probe.ps1
- diff.txt
- expected_paths.json
- get_token.ps1
- login.bat
- login.json
- logs_resp.json
- logs_v2.json
- metrics_nodes_resp.json
- metrics_sys_resp.json
- min_probe.ps1
- new_tests.txt
- nodes_resp.json
- old_tests.txt
- policies_after_create.json
- policies_after_delete.json
- policies_before.json
- policy_create_resp.json
- probe_api.ps1
- quick_probe.ps1
- scheduling_policy_get.json
- scheduling_policy_put.json
- scripts/db-status.ts
- tasks_failed_resp.json
- tasks_pending_resp.json
- tasks_resp.json
- tasks_running_resp.json
- tests/load/results...
- token_raw.json
- webhooks_resp.json
- weights_put_resp.json
- weights_resp.json

## 2. `ARCHITECTURE.md` and `.gitignore`

- **Origin of changes**: The changes were likely from earlier sessions (such as the documentation updates referenced weeks ago) because `ARCHITECTURE.md`'s last commit was `e8d989d` on June 20, 2026, and `.gitignore` was last updated on June 24, 2026. This session did not explicitly modify them before the reset.
- **Recoverability**: NO. Because these changes were never staged (never `git add`ed), Git has no record of the diffs. They are permanently gone.
- **Significance**: Substantial. If `ARCHITECTURE.md` held architecture documentation work from weeks ago, all that progress has been wiped out.

## 3. Every Other File

For all other 40 modified files (e.g., API routes, Web UI components, sagas, SDK, testing files) and all 56 untracked files (e.g., test scripts, probe data, JSON outputs):

- **Recoverability**: NO. They were entirely unstaged and untracked. No diffs are available, and they cannot be restored via Git.
- **Significance**: Massive. The list of modified files indicates severe collateral damage covering core orchestration services (`task-scheduler.ts`, `heartbeat-monitor.ts`), API route logic, UI components, generated client SDKs, and comprehensive test suites. This likely represents days or weeks of uncommitted implementation work that has been permanently destroyed.
