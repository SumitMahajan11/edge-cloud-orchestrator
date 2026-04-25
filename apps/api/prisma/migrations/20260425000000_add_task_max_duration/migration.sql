-- Add maxDurationSeconds column to tasks table
ALTER TABLE "tasks" ADD COLUMN "maxDurationSeconds" INTEGER NOT NULL DEFAULT 3600;
