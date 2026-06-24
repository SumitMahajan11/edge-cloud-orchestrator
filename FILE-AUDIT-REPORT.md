# FILE-AUDIT-REPORT — Phase A
Date: 2026-06-24 08:05
Status: SCAN ONLY — nothing deleted

## INSTRUCTIONS FOR PHASE B
To approve deletions, reply with the exact file paths or group names you approve.
Example: "Approve GROUP-1 and GROUP-2, skip GROUP-3"
Phase B will not run without explicit written approval.

---

## GROUP-1: Scratch/Temp Files from Agent Sessions (untracked, loose on disk)

These files exist on disk but are **not** git-tracked. They were created during debugging
and ML measurement sessions and were never cleaned up.

### 1a — Root-level JS/TS one-shot scripts

| File | Size (bytes) | Last Modified | Recommendation | Risk if deleted |
|------|-------------|--------------|----------------|-----------------|
| `check_carbon_records.js` | 408 | 2026-06-23 | DELETE-PROPOSED | None — one-off DB query |
| `check_db_state.js` | 1,250 | 2026-06-23 | DELETE-PROPOSED | None — one-off DB query |
| `check_outcomes.js` | 550 | 2026-06-23 | DELETE-PROPOSED | None — one-off DB query |
| `list_models.js` | 165 | 2026-06-23 | DELETE-PROPOSED | None — one-liner |
| `measure_carbon_shift.js` | 12,771 | 2026-06-23 | DELETE-PROPOSED | Low — test harness, superseded by scripts/ |
| `test_query.js` | 575 | 2026-06-23 | DELETE-PROPOSED | None — one-off query |
| `validate_bandit_fix.ts` | 4,973 | 2026-06-23 | DELETE-PROPOSED | None — manual validation script |

### 1b — Root-level .txt output files (untracked)

| File | Size (bytes) | Last Modified | Recommendation | Risk if deleted |
|------|-------------|--------------|----------------|-----------------|
| `fix_before.txt` | 565 | 2026-06-23 | DELETE-PROPOSED | None — before/after diff artifact |
| `fix_after.txt` | 347 | 2026-06-23 | DELETE-PROPOSED | None — before/after diff artifact |
| `ml_setup_confirmed.txt` | 1,612 | 2026-06-23 | DELETE-PROPOSED | None — confirmation log |
| `ml3_fl_rounds.txt` | 174 | 2026-06-23 | DELETE-PROPOSED | None — 3-line interim result |
| `regression_fix_tunable_before.txt` | 26,702 | 2026-06-20 | DELETE-PROPOSED | None — snapshot before regression fix |
| `verify_full_test_output.txt` | 1,404,580 | 2026-06-20 | DELETE-PROPOSED | None — 1.4MB test stdout dump |

### 1c — Root-level .log files (untracked, very large)

| File | Size (bytes) | Last Modified | Recommendation | Risk if deleted |
|------|-------------|--------------|----------------|-----------------|
| `api.log` | 1,644,589,082 (1.5 GB) | recent | DELETE-PROPOSED | None — API stdout dump |
| `ml_setup_api.log` | 641,664 | 2026-06-24 | DELETE-PROPOSED | None — ML setup run log |
| `ml_setup_api_err.log` | 0 | 2026-06-23 | DELETE-PROPOSED | None — empty file |
| `local_trace.log` | 26,630,696 | recent | DELETE-PROPOSED | None — trace output |
| `final_audit_section6.log` | 17,276,742 | recent | DELETE-PROPOSED | None — audit session log |
| `api-loadtest-final.log` | 10,792,142 | recent | DELETE-PROPOSED | None — load test output |
| `api_output.log` | 5,508,370 | recent | DELETE-PROPOSED | None — API output capture |
| `out.log` / `out2.log` | 3.5–3.6 MB each | recent | DELETE-PROPOSED | None — stdout redirects |
| `test-output-final3.log` | 176,944 | 2026-06-21 | DELETE-PROPOSED | None — test output |
| `test-output.log` | 328,900 | 2026-06-21 | DELETE-PROPOSED | None — test output |
| `test_output.log` | 109,918 | 2026-06-13 | DELETE-PROPOSED | None |
| `test_output_utf8.log` | 247,917 | 2026-06-12 | DELETE-PROPOSED | None |
| `test_run.log` | 47,338 | 2026-06-13 | DELETE-PROPOSED | None |
| `test_run2.log` | 1,213,732 | 2026-06-12 | DELETE-PROPOSED | None |
| `test_run3.log` | 1,214,182 | 2026-06-12 | DELETE-PROPOSED | None |
| `verify_api_boot.log` | 12,084 | 2026-06-20 | DELETE-PROPOSED | None |
| `vitest-out-utf8.log` | 45,525 | 2026-06-13 | DELETE-PROPOSED | None |
| `vitest-out.log` | 90,782 | 2026-06-13 | DELETE-PROPOSED | None |
| `BENCHMARK.md` | 691 | 2026-06-19 | REVIEW | Low — minimal benchmark note; superseded by ML results |

### 1d — Sub-directory loose log files (untracked)

| File | Size (bytes) | Recommendation |
|------|-------------|----------------|
| `apps/agent/agent.log` | 603,034 | DELETE-PROPOSED |
| `apps/api/isolate-*.log` (3 files) | 14.5 MB total | DELETE-PROPOSED — V8 heap dumps |
| `apps/api/test_run.log` | 45,558 | DELETE-PROPOSED |
| `tests/integration_run.log` | 1,205,774 | DELETE-PROPOSED |
| `tests/integration_run_utf8.log` | 603,192 | DELETE-PROPOSED |
| `tests/load/isolate-*.log` (3 files) | 14.4 MB total | DELETE-PROPOSED — V8 heap dumps |
| `tests/load/results/api-error.log` | 750 | DELETE-PROPOSED |
| `tests/load/results/api-real-infra.log` | 10,565,016 | DELETE-PROPOSED |
| `tests/load/results/api-run.log` | 102,955,728 | DELETE-PROPOSED — 98 MB |
| `tests/load/results/api.log` | 783,652,329 | DELETE-PROPOSED — 747 MB |

**GROUP-1 estimated disk space recoverable: ~2,526 MB (2.5 GB)**

---

## GROUP-2: Unverified / Fabricated Report Files

These were explicitly quarantined during a prior audit. They contain content that was
not empirically verified and was labeled as potentially fabricated.

| File | Size (bytes) | Last Modified | Recommendation | Risk if deleted |
|------|-------------|--------------|----------------|-----------------|
| `docs/_unverified/FINAL-AUDIT-REPORT-UNVERIFIED.md` | 4,636 | 2026-06-20 | DELETE-PROPOSED | None — superseded by FINAL-AUDIT-REPORT.md |
| `docs/_unverified/MASTER-REPORT-UNVERIFIED-DO-NOT-TRUST.md` | 14,719 | 2026-06-20 | DELETE-PROPOSED | None — explicitly quarantined |

No large .md files (>50KB) exist outside `node_modules`.

**GROUP-2 estimated disk space recoverable: ~19 KB**

---

## GROUP-3: Backup / Duplicate Source Files

### 3a — `.old` webpack cache files (in `apps/web/.next/cache/webpack/`)

These are standard Next.js webpack cache rotation files. They are **not** git-tracked and
are safely regenerated on next build. However, they should not be committed.

| File | Size (bytes) | Recommendation |
|------|-------------|----------------|
| `apps/web/.next/cache/webpack/client-development/index.pack.gz.old` | 1,147,938 | DELETE-PROPOSED |
| `apps/web/.next/cache/webpack/client-production/index.pack.old` | 30,964,864 | DELETE-PROPOSED |
| `apps/web/.next/cache/webpack/edge-server-production/index.pack.old` | 25,649 | DELETE-PROPOSED |
| `apps/web/.next/cache/webpack/server-development/index.pack.gz.old` | 1,228,834 | DELETE-PROPOSED |
| `apps/web/.next/cache/webpack/server-production/index.pack.old` | 30,720,094 | DELETE-PROPOSED |

**Note:** These are in `.next/` which should be in `.gitignore`. Verify `.gitignore` covers `apps/web/.next/`.

### 3b — Duplicate benchmark.ts files (git-tracked)

Two files with the same name exist in different locations — both are git-tracked:

| File | Recommendation |
|------|----------------|
| `apps/web/src/lib/benchmark.ts` | REVIEW — check if one is dead code |
| `apps/web/src/lib/utils/benchmark.ts` | REVIEW — check if one is dead code |

No duplicate test file names (`.test.ts` / `.spec.ts`) were found.

**GROUP-3 estimated disk space recoverable: ~62 MB (webpack .old files)**

---

## GROUP-4: Leftover Directories

### 4a — `scratch/` directory (git-tracked)

The `scratch/` directory exists and is committed to git. It contains 21 files (880 KB)
that are one-off debugging scripts and audit output files.

| File | Size | Recommendation |
|------|------|----------------|
| `scratch/audit_after.json` | 58,710 | DELETE-PROPOSED |
| `scratch/audit_new.json` | 524,232 | DELETE-PROPOSED |
| `scratch/audit_new.txt` | 289,432 | DELETE-PROPOSED |
| `scratch/check-env.ts` | 574 | DELETE-PROPOSED |
| `scratch/check-nodes-regions.ts` | 479 | DELETE-PROPOSED |
| `scratch/check-nodes.ts` | 255 | DELETE-PROPOSED |
| `scratch/check-post.ts` | 931 | DELETE-PROPOSED |
| `scratch/check-redis.ts` | 386 | DELETE-PROPOSED |
| `scratch/check-tenants.ts` | 485 | DELETE-PROPOSED |
| `scratch/create_issues.js` | 11,925 | REVIEW — GitHub issue automation, may be reusable |
| `scratch/diff-schemas.js` | 1,282 | DELETE-PROPOSED |
| `scratch/extracted_prompt.txt` | 1,016 | DELETE-PROPOSED |
| `scratch/find_files.js` | 2,156 | DELETE-PROPOSED |
| `scratch/init-s3.ts` | 1,222 | REVIEW — S3 init utility; check if scripts/ has equivalent |
| `scratch/pin_issues.js` | 2,301 | REVIEW — GitHub automation utility |
| `scratch/prompt.txt` | 1,003 | DELETE-PROPOSED |
| `scratch/search_log.js` | 651 | DELETE-PROPOSED |
| `scratch/test-api.ts` | 575 | DELETE-PROPOSED |
| `scratch/test-fetch.js` | 1,035 | DELETE-PROPOSED |
| `scratch/test-login.js` | 1,081 | DELETE-PROPOSED |
| `scratch/test-metadata.ts` | 1,564 | DELETE-PROPOSED |

### 4b — `temp_ml/` directory

Found but **empty**. Safe to delete the directory itself.

### 4c — Unexpected top-level directories (not leftover — legitimate)

The following were flagged as unexpected but are legitimate project directories:
`.agent`, `.devcontainer`, `.githooks`, `.husky`, `certs`, `config`, `containers`,
`data`, `infra`, `models`, `monitoring`, `patches`

**Recommendation: KEEP all** — these are project infrastructure.

**GROUP-4 estimated disk space recoverable: ~880 KB (scratch dir)**

---

## GROUP-5: Accidentally Git-Tracked Output Files

These files are committed to git but should not be — they are debugging artifacts,
test outputs, and tool-generated dumps. All should be `git rm`-ed and added to `.gitignore`.

### 5a — Root-level .txt files (git-tracked debug outputs)

| File | Size (bytes) | Recommendation |
|------|-------------|----------------|
| `actual_tasks.txt` | 23,236 | DELETE-PROPOSED (git rm) |
| `api_errors.txt` | 133,436 | DELETE-PROPOSED (git rm) |
| `api_test_results.txt` | 12,776 | DELETE-PROPOSED (git rm) |
| `api_test_results_utf8.txt` | ~13,000 | DELETE-PROPOSED (git rm) |
| `audit.txt` | 251,788 | DELETE-PROPOSED (git rm) |
| `audit_final.txt` | 133,190 | DELETE-PROPOSED (git rm) |
| `audit_results.txt` | 14,868 | DELETE-PROPOSED (git rm) |
| `build_all.txt` | 11,204 | DELETE-PROPOSED (git rm) |
| `confirm_check1.txt` | 26,644 | DELETE-PROPOSED (git rm) |
| `confirm_check2.txt` | 24,954 | DELETE-PROPOSED (git rm) |
| `console_errors.txt` | 19,822 | DELETE-PROPOSED (git rm) |
| `coverage.txt` | 99,054 | DELETE-PROPOSED (git rm) |
| `coverage_task_scheduler.txt` | 100,114 | DELETE-PROPOSED (git rm) |
| `coverage_task_scheduler_utf8.txt` | ~50,000 | DELETE-PROPOSED (git rm) |
| `coverage_utf8.txt` | ~50,000 | DELETE-PROPOSED (git rm) |
| `current_floating_promises.txt` | 156,534 | DELETE-PROPOSED (git rm) |
| `defined-env.txt` | 1,006 | DELETE-PROPOSED (git rm) |
| `diff_tasks.txt` | 9,294 | DELETE-PROPOSED (git rm) |
| `filtered_dead_code_report.txt` | 5,714 | DELETE-PROPOSED (git rm) |
| `fix_after.txt` | 347 | DELETE-PROPOSED (git rm) |
| `fix_before.txt` | 565 | DELETE-PROPOSED (git rm) |
| `fix_schema_result.txt` | 466,526 | DELETE-PROPOSED (git rm) |
| `floating_promises.txt` | 27,228 | DELETE-PROPOSED (git rm) |
| `integration_output.txt` | 30,448 | DELETE-PROPOSED (git rm) |
| `lint-api.txt` | 1,831,984 | DELETE-PROPOSED (git rm) |
| `lint_results.txt` | 4,625,434 | DELETE-PROPOSED (git rm) |
| `ml_verify_infra.txt` | 2,618 | REVIEW — infrastructure verification notes |
| `parsed_test_failures.txt` | 20,436 | DELETE-PROPOSED (git rm) |
| `rate_limit_fix_*.txt` (10 files) | ~10,000 each | DELETE-PROPOSED (git rm) |
| `regression_fix_tunable_before.txt` | 26,702 | DELETE-PROPOSED (git rm) |
| `skipped_tests_inventory.txt` | 1,424,644 | DELETE-PROPOSED (git rm) |
| `skipped_tests_inventory_utf8.txt` | ~689,000 | DELETE-PROPOSED (git rm) |
| `targeted_diff.txt` | 1,883 | DELETE-PROPOSED (git rm) |
| `test_output_2.txt` | 28,342 | DELETE-PROPOSED (git rm) |
| `test_results.txt` | 1,420,996 | DELETE-PROPOSED (git rm) |
| `test_saga_output.txt` | 72,114 | DELETE-PROPOSED (git rm) |
| `used-env.txt` | 912 | DELETE-PROPOSED (git rm) |
| `user_prompt.txt` | 1,023 | DELETE-PROPOSED (git rm) |
| `verify_full_test_output.txt` | 1,404,580 | DELETE-PROPOSED (git rm) |
| `verify_scenario_a.txt` to `verify_scenario_d.txt` (4 files) | ~5,000 each | DELETE-PROPOSED (git rm) |
| `verify_webhook_test.txt` | ~5,000 | DELETE-PROPOSED (git rm) |
| `verify_websocket_test.txt` | ~5,000 | DELETE-PROPOSED (git rm) |
| `workspace_pkgs.txt` | 3,582 | DELETE-PROPOSED (git rm) |

### 5b — Root-level .json files (git-tracked analysis dumps)

| File | Size (bytes) | Recommendation |
|------|-------------|----------------|
| `actual_paths.json` | 145,046 | DELETE-PROPOSED (git rm) |
| `all_loggers.json` | 65,092 | DELETE-PROPOSED (git rm) |
| `ast_incorrect_calls.json` | 3 | DELETE-PROPOSED (git rm) — empty |
| `broad_candidates.json` | ~50,000 | DELETE-PROPOSED (git rm) |
| `deps.json` | 3,754,514 | DELETE-PROPOSED (git rm) — 3.7 MB dependency dump |
| `deps_utf8.json` | 1,837,060 | DELETE-PROPOSED (git rm) |
| `entire_repo_candidates.json` | 187,265 | DELETE-PROPOSED (git rm) |
| `expected_paths.json` | 145,046 | DELETE-PROPOSED (git rm) |
| `filtered_incorrect_calls.json` | 3 | DELETE-PROPOSED (git rm) — empty |
| `incorrect_calls.json` | 103,504 | DELETE-PROPOSED (git rm) |
| `incorrect_loggers.json` | 3 | DELETE-PROPOSED (git rm) — empty |
| `multiline_incorrect_calls.json` | 101,479 | DELETE-PROPOSED (git rm) |
| `schema_drift_actual.json` | 159,140 | DELETE-PROPOSED (git rm) |
| `schema_drift_expected.json` | 158,825 | DELETE-PROPOSED (git rm) |
| `target_comma_loggers.json` | 39,583 | DELETE-PROPOSED (git rm) |
| `test-results.json` | 210,036 | DELETE-PROPOSED (git rm) |
| `test_assertions.json` | 3,234 | DELETE-PROPOSED (git rm) |
| `test_summary.json` | 4,118 | DELETE-PROPOSED (git rm) |
| `tests_failures.json` | 273,906 | DELETE-PROPOSED (git rm) |

### 5c — apps/api root-level output files (git-tracked)

| File | Size (bytes) | Recommendation |
|------|-------------|----------------|
| `apps/api/debug.txt` | 51 | DELETE-PROPOSED (git rm) |
| `apps/api/debug_forgery.txt` | 221 | DELETE-PROPOSED (git rm) |
| `apps/api/debug_valid.txt` | 1,273 | DELETE-PROPOSED (git rm) |
| `apps/api/test_results.txt` | 45,560 | DELETE-PROPOSED (git rm) |
| `apps/api/ts-errors-utf8.txt` | 103,629 | DELETE-PROPOSED (git rm) |
| `apps/api/ts-errors.txt` | 207,254 | DELETE-PROPOSED (git rm) |
| `apps/api/ts_out.txt` | 196,846 | DELETE-PROPOSED (git rm) |
| `apps/api/ts_out_2.txt` | 79,604 | DELETE-PROPOSED (git rm) |
| `apps/api/ts_out_3.txt` | 72,898 | DELETE-PROPOSED (git rm) |
| `apps/api/ts_out_final.txt` | 68,740 | DELETE-PROPOSED (git rm) |
| `apps/api/ts_out_final_v2.txt` | 53,934 | DELETE-PROPOSED (git rm) |
| `apps/api/ts_out_utf8.txt` | 98,425 | DELETE-PROPOSED (git rm) |
| `apps/api/tsc_source_errors.txt` | 83,372 | DELETE-PROPOSED (git rm) |
| `apps/api/tsc_source_errors_utf8.txt` | 41,688 | DELETE-PROPOSED (git rm) |
| `apps/api/lint-results.json` | 2,336,430 | DELETE-PROPOSED (git rm) — 2.2 MB lint dump |

### 5d — Large files that should not be in git

| File | Size | Recommendation |
|------|------|----------------|
| `apps/api/hello.wasm` | 1,966 KB | REVIEW — may be intentional (WebAssembly artifact); check if needed |
| `apps/api/openapi.yml` | 112 KB | KEEP — API spec, intentional |
| `apps/api/openapi-v2.yml` | 98 KB | KEEP — API spec, intentional |
| `docs/api-reference.html` | 1,660 KB | REVIEW — generated from openapi; could be .gitignored |
| `docs/postman-collection.json` | 147 KB | KEEP — useful for team |
| `pnpm-lock.yaml` | 711 KB | KEEP — required lockfile |
| `apps/agent/Cargo.lock` | 153 KB | KEEP — Rust lockfile |

### 5e — .gitignore gaps

The `.gitignore` covers `*.log` but many `.txt` and analysis `.json` files slipped through.
**Recommended additions to `.gitignore`:**
```
# Agent session output files
*.txt
!README.txt
!packages/ml-scheduler/src/training/requirements.txt
# Analysis dumps
deps.json
deps_utf8.json
*_candidates.json
*_incorrect_calls.json
*_loggers.json
schema_drift_*.json
test-results.json
tests_failures.json
test_assertions.json
test_summary.json
lint_results.txt
lint-api.txt
skipped_tests_inventory*.txt
# scratch
scratch/
```

**GROUP-5 estimated tracked file size (git rm): ~14.4 MB (git objects)**

---

## GROUP-6: Suspect Orphaned Source Files

> **Warning: HIGH false-positive rate.** The automated orphan scan was aborted (524 files × 524 grep passes was too slow).
> The following are **manually identified** strong orphan candidates based on naming patterns and context.

| File | Reason Flagged | Recommendation |
|------|---------------|----------------|
| `apps/web/src/lib/benchmark.ts` | Duplicate of `utils/benchmark.ts`; likely one is unused | REVIEW |
| `apps/web/src/lib/utils/benchmark.ts` | Duplicate of parent `benchmark.ts` | REVIEW |
| `test-heartbeat.ts` (root) | Root-level one-off script, not imported anywhere | DELETE-PROPOSED |
| `test-prisma.ts` (root) | Root-level one-off script, not imported anywhere | DELETE-PROPOSED |
| `.dependency-cruiser.js` (root) | Config file for dep-cruiser — KEEP if tool is in use | REVIEW |

Manual review recommended for files in `packages/` and `apps/` before any deletion.

**GROUP-6: 5 files flagged — verify manually before any deletion**

---

## GROUP-7: ML Measurement Artifacts (keep or commit — for discussion)

All 5 ML result and verification files are **already committed** to git.

| File | Size | Tracked | Recommendation |
|------|------|---------|----------------|
| `ML-1-CARBON-RESULTS.txt` | 2,390 | ✅ Yes | KEEP — empirical benchmark evidence |
| `ML-2-BANDIT-RESULTS.txt` | 5,580 | ✅ Yes | KEEP — empirical benchmark evidence |
| `ML-3-FEDERATED-RESULTS.txt` | 6,841 | ✅ Yes | KEEP — empirical benchmark evidence |
| `VERIFIED-AUDIT-REPORT.md` | 3,536 | ✅ Yes | KEEP — verified audit summary |
| `FINAL-AUDIT-REPORT.md` | 5,168 | ✅ Yes | KEEP — project milestone doc |

**Recommendation:** Move these into `docs/results/` for better organization (optional, Phase B decision).

---

## SUMMARY

| Group | Files Found | Recommended Action | Est. Space |
|-------|-------------|--------------------|------------|
| GROUP-1 | 65 | DELETE-PROPOSED (untracked) | ~2,526 MB |
| GROUP-2 | 2 | DELETE-PROPOSED | ~19 KB |
| GROUP-3a | 5 `.next` `.old` files | DELETE-PROPOSED (untracked) | ~62 MB |
| GROUP-3b | 2 | REVIEW (possible duplicate) | ~0 KB |
| GROUP-4 | `scratch/` (21 files) + `temp_ml/` (empty) | DELETE-PROPOSED (needs git rm) | ~880 KB |
| GROUP-5 | ~80 tracked output files | DELETE-PROPOSED (git rm + .gitignore fix) | ~14.4 MB tracked |
| GROUP-6 | 5 | REVIEW (high false-positive rate) | N/A |
| GROUP-7 | 5 | KEEP | 18 KB |

**Total disk space recoverable (untracked files alone): ~2,590 MB (~2.5 GB)**
**Total git history cleaned (tracked output files via git rm): ~14.4 MB**
**Total .next cache recoverable: ~62 MB**

---

## NOTES ON .gitignore GAPS
The current `.gitignore` correctly ignores `*.log` but missed:
- `*.txt` output files (audit dumps, test outputs)
- Analysis `.json` dumps at root level
- The `scratch/` directory entirely
- `apps/api/*.txt` debug outputs

These should be added in Phase B alongside the file deletions.
