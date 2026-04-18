#!/bin/bash
set -e

# Database Migration Health Check Script
# Usage: ./db-migrate-health.sh [--pre | --post]

MODE=$1
DB_URL=${DATABASE_URL}

if [ -z "$DB_URL" ]; then
  echo "Error: DATABASE_URL environment variable is not set."
  exit 1
fi

check_connection() {
  echo "Checking database connectivity..."
  # Simple psql check (assumes psql client is installed in CI image)
  if ! psql "$DB_URL" -c "SELECT 1" > /dev/null 2>&1; then
    echo "Error: Could not connect to the database."
    exit 1
  fi
  echo "Connection successful."
}

check_migration_status() {
  echo "Verifying migration history..."
  # Check for failed migrations in Prisma's tracking table
  FAILED_COUNT=$(psql "$DB_URL" -t -c "SELECT count(*) FROM \"_prisma_migrations\" WHERE finished_at IS NULL AND logs IS NOT NULL;")
  
  if [ "$(echo $FAILED_COUNT | xargs)" -gt 0 ]; then
    echo "CRITICAL: Detected $(echo $FAILED_COUNT | xargs) failed migration(s) in _prisma_migrations!"
    echo "Please resolve manually before proceeding."
    exit 1
  fi
  echo "No failed migrations detected."
}

post_migration_probe() {
  echo "Running post-migration schema validation..."
  # Example: Check if a fundamental table still exists and is readable
  if ! psql "$DB_URL" -c "SELECT count(*) FROM \"users\" LIMIT 1" > /dev/null 2>&1; then
    echo "Error: Post-migration probe failed! 'users' table is unreachable."
    exit 1
  fi
  echo "Post-migration probe successful."
}

case $MODE in
  --pre)
    check_connection
    check_migration_status
    ;;
  --post)
    post_migration_probe
    ;;
  *)
    echo "Usage: $0 [--pre | --post]"
    exit 1
    ;;
esac
