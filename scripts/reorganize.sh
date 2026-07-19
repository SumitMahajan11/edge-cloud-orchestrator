#!/usr/bin/env bash
# reorganize.sh — Single authoritative reorganization script for edge-cloud-orchestrator
# Run from the repo root: bash scripts/reorganize.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "==> Reorganizing $ROOT"

# ── TASK 4: Ensure docs sub-directories exist ────────────────────────────────
mkdir -p docs/archive docs/decisions docs/diagrams docs/guides

# ── TASK 4: Archive root-level AI-generated *.md reports ────────────────────
for f in CHRONICLE.md CODE_QUALITY_REFACTORING.md CODE_QUALITY_REPORT.md \
  COMPREHENSIVE_PROJECT_REPORT.md DEPLOYMENT_CHECKLIST.md \
  INFRASTRUCTURE_FINAL_SUMMARY.md INFRASTRUCTURE_HARDENING_PLAN.md \
  INFRASTRUCTURE_QUICK_REFERENCE.md INFRASTRUCTURE_UPGRADE_REPORT.md \
  PHASE_4_COMPLETION_STATUS.md PHASE_5_EXECUTIVE_SUMMARY.md \
  PHASE_6_FINAL_SUMMARY.md PHASE_6_PRODUCTION_DEPLOYMENT.md \
  PROJECT_DETAILED_REPORT.md PROJECT_REPORT.md PROJECT_STRUCTURE.md \
  QA_VALIDATION_REPORT.md QUICK_FIX_GUIDE.md QUICKSTART.md \
  README-PRODUCTION.md RELIABILITY_EXECUTIVE_SUMMARY.md \
  RELIABILITY_FINAL_REPORT.md RELIABILITY_FIXES_SUMMARY.md \
  RELIABILITY_HARDENING_PLAN.md RELIABILITY_IMPLEMENTATION_PLAN.md \
  RELIABILITY_QUICK_START.md RELIABILITY_VALIDATION_GUIDE.md \
  SECURITY_AUDIT_REPORT.md SECURITY_FIXES_REPORT.md \
  SECURITY_HARDENING_PLAN.md SECURITY_SUMMARY.md \
  SECURITY_VALIDATION_CHECKLIST.md START_HERE.md ULTIMATE_PROJECT_REPORT.md; do
  [ -f "$f" ] && mv "$f" docs/archive/ && echo "  archived: $f"
done

# Archive leftover scratch/temp root files
for f in all_files.txt backend_logs.txt eslint.log eslint.txt eslint_report.json \
  lint-results.json lint-results.txt lint.txt lint_results.txt lint_summary.txt \
  ps.json ps.txt replacements.txt sandbox-dump.txt tap.txt test-results.txt \
  test.json test_results.json test_results.txt typecheck.log vitest-output.txt \
  abac-test.json package.json.backup package-lock.json; do
  [ -f "$f" ] && mv "$f" docs/archive/ && echo "  archived: $f"
done

# ── TASK 4: Consolidate ADR directories ─────────────────────────────────────
# docs/adr/ → docs/decisions/ (rename to avoid number conflict with existing 002)
if [ -f docs/adr/002-api-gateway-nginx.md ]; then
  # Already have 002-gateway-nginx.md in decisions/ — rename adr version
  mv docs/adr/002-api-gateway-nginx.md docs/decisions/002b-api-gateway-nginx.md
  echo "  moved: docs/adr/002-api-gateway-nginx.md → docs/decisions/002b-api-gateway-nginx.md"
fi
if [ -f docs/adr/003-deployment-kustomize-argocd.md ]; then
  # Check if 003 already exists
  if [ ! -f docs/decisions/003-deployment-kustomize.md ]; then
    mv docs/adr/003-deployment-kustomize-argocd.md docs/decisions/003-deployment-kustomize-argocd.md
  else
    mv docs/adr/003-deployment-kustomize-argocd.md docs/archive/adr-003-deployment-kustomize-argocd.md
  fi
  echo "  moved: docs/adr/003-deployment-kustomize-argocd.md"
fi
rmdir docs/adr 2>/dev/null && echo "  removed: docs/adr/" || true

# Move guide-style docs to docs/guides/
[ -f docs/MTLS_SPECIFICATION.md ]      && mv docs/MTLS_SPECIFICATION.md      docs/guides/mtls-setup.md
[ -f docs/CA_ROTATION_STRATEGY.md ]    && mv docs/CA_ROTATION_STRATEGY.md    docs/guides/ca-rotation.md
[ -f docs/cicd-setup.md ]              && mv docs/cicd-setup.md              docs/guides/cicd-setup.md
[ -f docs/database-migrations.md ]     && mv docs/database-migrations.md     docs/guides/database-migrations.md
[ -f docs/TESTING.md ]                 && mv docs/TESTING.md                 docs/guides/testing.md
[ -f docs/compatibility-matrix.md ]    && mv docs/compatibility-matrix.md    docs/guides/compatibility-matrix.md

# Move verbose project reports in docs/ to archive
[ -f docs/FOLDER_REORGANIZATION.md ]         && mv docs/FOLDER_REORGANIZATION.md        docs/archive/
[ -f docs/ARCHITECTURE_IMPROVEMENTS.md ]     && mv docs/ARCHITECTURE_IMPROVEMENTS.md    docs/archive/
[ -f docs/CONTROL_DATA_PLANE_ARCHITECTURE.md ] && mv docs/CONTROL_DATA_PLANE_ARCHITECTURE.md docs/archive/
[ -f docs/COST_AWARE_SCHEDULING.md ]         && mv docs/COST_AWARE_SCHEDULING.md        docs/archive/
[ -f docs/METRICS_SPECIFICATION.md ]         && mv docs/METRICS_SPECIFICATION.md        docs/guides/metrics-specification.md

# ── TASK 2: Fix apps/api ─────────────────────────────────────────────────────
# (Previously migrated apps/api/k8s to infra/k8s; now obsolete and removed)
if [ -f apps/api/docker-compose.yml ]; then
  mkdir -p infra/docker
  mv apps/api/docker-compose.yml infra/docker/api-docker-compose.yml
  echo "  moved: apps/api/docker-compose.yml → infra/docker/api-docker-compose.yml"
fi
if [ -f apps/api/prometheus.yml ]; then
  mv apps/api/prometheus.yml monitoring/prometheus/api-rules.yml
  echo "  moved: apps/api/prometheus.yml → monitoring/prometheus/api-rules.yml"
fi
if [ -f apps/api/package-lock.json ]; then
  rm apps/api/package-lock.json
  echo "  removed: apps/api/package-lock.json"
fi

# ── TASK 2: Fix apps/agent ───────────────────────────────────────────────────
if [ -f apps/agent/generate-certs.sh ]; then
  mv apps/agent/generate-certs.sh scripts/generate-certs.sh
  echo "  moved: apps/agent/generate-certs.sh → scripts/generate-certs.sh"
fi
if [ -f apps/agent/MIGRATION.md ]; then
  mv apps/agent/MIGRATION.md docs/guides/agent-migration.md
  echo "  moved: apps/agent/MIGRATION.md → docs/guides/agent-migration.md"
fi
if [ -f apps/agent/package-lock.json ]; then
  rm apps/agent/package-lock.json
  echo "  removed: apps/agent/package-lock.json"
fi

# ── TASK 1: Consolidate config/ ──────────────────────────────────────────────
# Keep only .env.example and .env.local in config/
# Archive extra env files
[ -f config/.env.development ] && mv config/.env.development docs/archive/env.development.example
[ -f config/.env.docker ]      && mv config/.env.docker      docs/archive/env.docker.example
# Flatten config/backend/ into config/ (if files don't already exist)
if [ -d config/backend ]; then
  [ -f config/backend/.env.example ]            && cp config/backend/.env.example            config/.env.backend.example
  [ -f config/backend/.env.production.example ] && cp config/backend/.env.production.example config/.env.production.example
  rm -rf config/backend
  echo "  flattened: config/backend/ → config/"
fi

# ── TASK 1: Consolidate infra/ ───────────────────────────────────────────────
# (Previously merged infra/kubernetes/ and infra/helm/ to infra/k8s/; now obsolete and removed)
# Merge infra/scripts/ into scripts/
if [ -d infra/scripts ]; then
  for f in infra/scripts/deploy.ps1 infra/scripts/generate-certs-local-dev.sh \
            infra/scripts/rotate-certs.sh infra/scripts/setup.ps1; do
    [ -f "$f" ] && mv "$f" "scripts/$(basename $f)" && echo "  moved: $f → scripts/"
  done
  rmdir infra/scripts 2>/dev/null || true
fi

# Move load-test scripts from monitoring/ to tests/k6/
mkdir -p tests/k6
[ -f monitoring/load-test.js ]             && mv monitoring/load-test.js            tests/k6/load-test.js
[ -f monitoring/load-test-large-scale.js ] && mv monitoring/load-test-large-scale.js tests/k6/load-test-large-scale.js
[ -f docker-compose.k6.yml ]               && mv docker-compose.k6.yml              tests/k6/docker-compose.k6.yml

echo ""
echo "==> Reorganization complete."
echo "    Review docs/archive/ and delete permanently if no longer needed."
