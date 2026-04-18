#!/bin/bash
set -e

# Database Backup Script
# Usage: ./db-backup.sh <git-sha>

GIT_SHA=$1
DB_URL=${DATABASE_URL}
BUCKET=${BACKUP_S3_BUCKET}

if [ -z "$GIT_SHA" ] || [ -z "$DB_URL" ] || [ -z "$BUCKET" ]; then
  echo "Error: Missing required variables (GIT_SHA, DATABASE_URL, or BACKUP_S3_BUCKET)."
  exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="backup_${TIMESTAMP}_${GIT_SHA}.sql.gz"

echo "Starting database backup to ${BACKUP_FILE}..."

# Perform pg_dump
pg_dump "$DB_URL" | gzip > "/tmp/${BACKUP_FILE}"

echo "Uploading backup to S3..."
aws s3 cp "/tmp/${BACKUP_FILE}" "s3://${BUCKET}/database-backups/${BACKUP_FILE}"

echo "Backup completed and uploaded successfully."

# Cleanup local file
rm "/tmp/${BACKUP_FILE}"
