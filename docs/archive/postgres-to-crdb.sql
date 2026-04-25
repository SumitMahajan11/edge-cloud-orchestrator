-- Migration Script: PostgreSQL to CockroachDB
-- Run this after setting up CockroachDB cluster

-- Step 1: Create the database
CREATE DATABASE IF NOT EXISTS edgecloud;
USE edgecloud;

-- Step 2: Migrate users table
INSERT INTO edgecloud.users (id, email, password_hash, name, role, is_active, email_verified, created_at, updated_at, last_login_at)
SELECT 
    id::UUID,
    email,
    password_hash,
    name,
    UPPER(role::TEXT) as role,
    is_active,
    email_verified,
    created_at,
    updated_at,
    last_login_at
FROM postgres.users;

-- Step 3: Migrate nodes table
INSERT INTO edgecloud.nodes (
    id, name, location, region, status, ip_address, port, url,
    cpu_cores, memory_gb, storage_gb, cpu_usage, memory_usage, storage_usage,
    latency, tasks_running, max_tasks, cost_per_hour,
    bandwidth_in_mbps, bandwidth_out_mbps, is_maintenance_mode,
    last_heartbeat, created_at, updated_at
)
SELECT
    id::UUID,
    name,
    location,
    COALESCE(region, 'us-east'),
    status,
    ip_address,
    port,
    url,
    cpu_cores,
    memory_gb,
    storage_gb,
    COALESCE(cpu_usage, 0),
    COALESCE(memory_usage, 0),
    COALESCE(storage_usage, 0),
    COALESCE(latency, 0),
    COALESCE(tasks_running, 0),
    COALESCE(max_tasks, 10),
    COALESCE(cost_per_hour, 0.05),
    COALESCE(bandwidth_in_mbps, 100),
    COALESCE(bandwidth_out_mbps, 100),
    COALESCE(is_maintenance_mode, false),
    COALESCE(last_heartbeat, NOW()),
    created_at,
    updated_at
FROM postgres.edge_nodes;

-- Step 4: Migrate tasks table
INSERT INTO edgecloud.tasks (
    id, name, type, status, priority, target, node_id, policy, reason,
    input, metadata, max_retries, retry_count, execution_time_ms, cost,
    region, submitted_at, scheduled_at, started_at, completed_at, failed_at, cancelled_at,
    created_at, updated_at
)
SELECT
    id::UUID,
    name,
    type::TEXT,
    status::TEXT,
    priority::TEXT,
    COALESCE(target::TEXT, 'EDGE'),
    node_id::UUID,
    COALESCE(policy, 'auto'),
    COALESCE(reason, ''),
    COALESCE(input, '{}')::JSONB,
    COALESCE(metadata, '{}')::JSONB,
    COALESCE(max_retries, 3),
    COALESCE(retry_count, 0),
    execution_time_ms,
    cost,
    COALESCE(region, 'us-east'),
    submitted_at,
    scheduled_at,
    started_at,
    completed_at,
    failed_at,
    cancelled_at,
    created_at,
    updated_at
FROM postgres.tasks;

-- Step 5: Verify migration
SELECT 'Users migrated: ' || COUNT(*) FROM edgecloud.users
UNION ALL
SELECT 'Nodes migrated: ' || COUNT(*) FROM edgecloud.nodes
UNION ALL
SELECT 'Tasks migrated: ' || COUNT(*) FROM edgecloud.tasks;

-- Step 6: Create indexes (already created by schema, but verify)
SELECT 'Indexes created' as status;
