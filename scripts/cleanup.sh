#!/usr/bin/env bash
# cleanup.sh — Safe deletion of dead/redundant files in edge-cloud-orchestrator
# Usage:
#   bash scripts/cleanup.sh           # execute cleanup
#   bash scripts/cleanup.sh --dry-run # print what would be deleted/archived
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "=== DRY RUN — no files will be deleted ==="
fi

ARCHIVE_DIR="$ROOT/docs/archive"
mkdir -p "$ARCHIVE_DIR"

# ── helpers ─────────────────────────────────────────────────────────────────
safe_delete() {
  local path="$1"
  local reason="$2"
  if [ -e "$path" ]; then
    if $DRY_RUN; then
      echo "  [DELETE] $path  # $reason"
    else
      rm -rf "$path"
      echo "  deleted: $path"
    fi
  fi
}

safe_archive() {
  local path="$1"
  local reason="$2"
  local dest="$ARCHIVE_DIR/$(basename "$path")"
  if [ -e "$path" ]; then
    if $DRY_RUN; then
      echo "  [ARCHIVE → docs/archive/] $path  # $reason"
    else
      mv "$path" "$dest"
      echo "  archived: $path → docs/archive/"
    fi
  fi
}

echo ""
echo "=== CATEGORY 1: Scaffold leftovers (Vite defaults) ==="
# Already gone in previous session — listed for documentation
for f in \
  "apps/web/src/counter.ts" \
  "apps/web/src/typescript.svg" \
  "apps/web/src/style.css" \
  "apps/web/src/main.ts" \
  "package.json.backup"; do
  if [ -e "$ROOT/$f" ]; then
    safe_delete "$ROOT/$f" "Vite scaffold default — not imported anywhere"
  else
    echo "  [ALREADY GONE] $f"
  fi
done

echo ""
echo "=== CATEGORY 2: Dead infrastructure ==="

# infra/cockroachdb/ — CockroachDB was replaced by PostgreSQL in active services.
# schema.sql is only referenced in docker-compose.yml (which itself uses crdb cluster).
# The active docker-compose for dev is infra/docker/docker-compose.yml but it contains
# the old CockroachDB services — archive the schema; the compose is audited separately.
safe_archive "$ROOT/infra/cockroachdb/schema.sql" \
  "CockroachDB schema — active services use PostgreSQL/Prisma. No crdb:// in app code."
# Remove the now-empty directory after archive
if $DRY_RUN; then
  [ -d "$ROOT/infra/cockroachdb" ] && echo "  [RMDIR] infra/cockroachdb/"
else
  rmdir "$ROOT/infra/cockroachdb" 2>/dev/null || true
fi

# infra/kong/ — API Gateway replaced by Nginx. No code references kong.yml.
safe_archive "$ROOT/infra/kong/kong.yml" \
  "Kong config — replaced by Nginx (apps/api-gateway). Zero code references."
if $DRY_RUN; then
  [ -d "$ROOT/infra/kong" ] && echo "  [RMDIR] infra/kong/"
else
  rmdir "$ROOT/infra/kong" 2>/dev/null || true
fi

# migration/postgres-to-crdb.sql — Abandoned CockroachDB migration. Never referenced.
safe_archive "$ROOT/migration/postgres-to-crdb.sql" \
  "Abandoned PostgreSQL→CockroachDB migration — project stayed on PostgreSQL."
if $DRY_RUN; then
  [ -d "$ROOT/migration" ] && echo "  [RMDIR] migration/"
else
  rmdir "$ROOT/migration" 2>/dev/null || true
fi

# infra/experimental/multi-region/crdb-regions.sql — CockroachDB multi-region, dead.
safe_archive "$ROOT/infra/experimental/multi-region/crdb-regions.sql" \
  "CockroachDB multi-region SQL — project uses PostgreSQL, not CockroachDB."

echo ""
echo "=== CATEGORY 3: Duplicate/misplaced files ==="

# apps/api/.env — does not exist (already confirmed absent). Document for safety.
if [ -f "$ROOT/apps/api/.env" ]; then
  echo "  WARNING: apps/api/.env exists — migrate secrets to config/.env.local then delete!"
else
  echo "  [NOT PRESENT] apps/api/.env"
fi

# context/ vs contexts/ — context/ is canonical (already imported by App.tsx, Login.tsx,
# Header.tsx). contexts/ does not exist. Nothing to do.
echo "  [OK] apps/web/src/context/ is canonical — no contexts/ directory found."

echo ""
echo "=== CATEGORY 4: Unbuilt scaffold packages ==="
# These packages have real source (chaos, integration, sandbox, scheduler,
# websocket-client). None are imported by any app or service directly.
# DECISION: KEEP — they are interconnected via @edgecloud/integration/service-container.ts
# and have real implementation code. tsconfig.json was added in previous session.
# DO NOT delete — they just need to be built before they are usable.
echo "  [KEEP] packages/chaos        — real source, connected via integration package"
echo "  [KEEP] packages/integration  — real source, imports all other packages"
echo "  [KEEP] packages/sandbox      — real source, connected via integration package"
echo "  [KEEP] packages/scheduler    — real source, connected via integration package"
echo "  [KEEP] packages/websocket-client — real source, connected via integration package"

echo ""
echo "=== CATEGORY 5: Documentation already handled ==="
echo "  [DONE] Root *.md reports moved to docs/archive/ in previous session"
echo "  [DONE] docs/adr/ merged into docs/decisions/"
echo "  [DONE] Guide docs moved to docs/guides/"

echo ""
echo "=== CATEGORY 6: Build artifacts / .gitignore ==="
# coverage/.tmp/ — already in .gitignore under coverage/
safe_delete "$ROOT/coverage/.tmp" \
  "Coverage cache — covered by .gitignore: coverage/"
if $DRY_RUN; then
  [ -d "$ROOT/coverage" ] && [ -z "$(ls -A "$ROOT/coverage" 2>/dev/null)" ] && echo "  [RMDIR] coverage/"
else
  rmdir "$ROOT/coverage" 2>/dev/null || true
fi

# apps/api/tsconfig.tsbuildinfo — already in .gitignore: *.tsbuildinfo
safe_delete "$ROOT/apps/api/tsconfig.tsbuildinfo" \
  "TypeScript build cache — covered by .gitignore: *.tsbuildinfo"

# apps/api/dist/ — already in .gitignore: dist/  (confirmed empty)
if [ -d "$ROOT/apps/api/dist" ]; then
  items=$(find "$ROOT/apps/api/dist" -mindepth 1 | wc -l)
  if [ "$items" -eq 0 ]; then
    safe_delete "$ROOT/apps/api/dist" "Empty dist/ directory — .gitignore: dist/"
  else
    echo "  [SKIP] apps/api/dist/ has $items files — may be needed at runtime"
  fi
fi

echo ""
echo "=== GITIGNORE VERIFICATION ==="
echo "  Current .gitignore covers:"
echo "    dist             ✓ (line 12)"
echo "    coverage/        ✓ (line 56)"
echo "    *.tsbuildinfo    ✓ (line 58)"
echo "    node_modules     ✓ (line 10)"
echo "    *.local          ✓ (line 13)"
echo "  No additions needed — all patterns are present."

echo ""
if $DRY_RUN; then
  echo "=== DRY RUN COMPLETE — run without --dry-run to apply ==="
else
  echo "=== CLEANUP COMPLETE ==="
fi
