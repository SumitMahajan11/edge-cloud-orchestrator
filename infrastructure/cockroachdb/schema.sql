-- CockroachDB Schema for Edge-Cloud Orchestrator
-- Optimized for distributed, multi-region deployment

-- Enable required extensions
SET CLUSTER SETTING kv.rangefeed.enabled = true;

-- Create database
CREATE DATABASE IF NOT EXISTS edgecloud;
USE edgecloud;

-- Tasks table with regional partitioning
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name STRING NOT NULL,
    type STRING NOT NULL,
    status STRING NOT NULL DEFAULT 'PENDING',
    priority STRING NOT NULL DEFAULT 'MEDIUM',
    target STRING NOT NULL DEFAULT 'EDGE',
    node_id UUID NULL,
    policy STRING NOT NULL DEFAULT 'auto',
    reason STRING NOT NULL DEFAULT '',
    input JSONB NULL,
    output JSONB NULL,
    metadata JSONB NULL,
    max_retries INT NOT NULL DEFAULT 3,
    retry_count INT NOT NULL DEFAULT 0,
    execution_time_ms INT NULL,
    cost DECIMAL(10, 4) NULL,
    region STRING NOT NULL DEFAULT 'us-east',
    submitted_at TIMESTAMP NOT NULL DEFAULT now(),
    scheduled_at TIMESTAMP NULL,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    failed_at TIMESTAMP NULL,
    cancelled_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    
    -- Indexes for common queries
    INDEX idx_status (status),
    INDEX idx_node (node_id),
    INDEX idx_region (region),
    INDEX idx_status_region (status, region),
    INDEX idx_submitted_at (submitted_at),
    INDEX idx_priority_status (priority, status),
    
    -- Partition by region for multi-region performance
    PARTITION BY LIST (region) (
        PARTITION us_east VALUES IN ('us-east'),
        PARTITION us_west VALUES IN ('us-west'),
        PARTITION eu VALUES IN ('eu'),
        PARTITION apac VALUES IN ('apac')
    )
) LOCALITY REGIONAL BY ROW;

-- Nodes table with regional partitioning
CREATE TABLE IF NOT EXISTS nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name STRING NOT NULL,
    location STRING NOT NULL,
    region STRING NOT NULL,
    status STRING NOT NULL DEFAULT 'OFFLINE',
    ip_address STRING NOT NULL,
    port INT NOT NULL,
    url STRING NOT NULL,
    cpu_cores INT NOT NULL,
    memory_gb INT NOT NULL,
    storage_gb INT NOT NULL,
    cpu_usage DECIMAL(5, 2) NOT NULL DEFAULT 0,
    memory_usage DECIMAL(5, 2) NOT NULL DEFAULT 0,
    storage_usage DECIMAL(5, 2) NOT NULL DEFAULT 0,
    latency INT NOT NULL DEFAULT 0,
    tasks_running INT NOT NULL DEFAULT 0,
    max_tasks INT NOT NULL DEFAULT 10,
    cost_per_hour DECIMAL(10, 4) NOT NULL DEFAULT 0.05,
    bandwidth_in_mbps INT NOT NULL DEFAULT 100,
    bandwidth_out_mbps INT NOT NULL DEFAULT 100,
    is_maintenance_mode BOOL NOT NULL DEFAULT false,
    capabilities STRING[] NULL,
    labels JSONB NULL,
    last_heartbeat TIMESTAMP NOT NULL DEFAULT now(),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    
    -- Indexes
    INDEX idx_status (status),
    INDEX idx_region (region),
    INDEX idx_status_region (status, region),
    INDEX idx_heartbeat (last_heartbeat),
    
    -- Partition by region
    PARTITION BY LIST (region) (
        PARTITION us_east VALUES IN ('us-east'),
        PARTITION us_west VALUES IN ('us-west'),
        PARTITION eu VALUES IN ('eu'),
        PARTITION apac VALUES IN ('apac')
    )
) LOCALITY REGIONAL BY ROW;

-- Task executions table for tracking attempts
CREATE TABLE IF NOT EXISTS task_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    node_id UUID NULL REFERENCES nodes(id) ON DELETE SET NULL,
    status STRING NOT NULL,
    attempt_number INT NOT NULL DEFAULT 1,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    execution_time_ms INT NULL,
    error_message STRING NULL,
    output JSONB NULL,
    region STRING NOT NULL DEFAULT 'us-east',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    
    INDEX idx_task (task_id),
    INDEX idx_node (node_id),
    INDEX idx_status (status),
    
    PARTITION BY LIST (region) (
        PARTITION us_east VALUES IN ('us-east'),
        PARTITION us_west VALUES IN ('us-west'),
        PARTITION eu VALUES IN ('eu'),
        PARTITION apac VALUES IN ('apac')
    )
) LOCALITY REGIONAL BY ROW;

-- Metrics table with time-series optimization
CREATE TABLE IF NOT EXISTS metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID NULL REFERENCES nodes(id) ON DELETE CASCADE,
    task_id UUID NULL REFERENCES tasks(id) ON DELETE CASCADE,
    metric_type STRING NOT NULL,
    value DECIMAL(18, 6) NOT NULL,
    labels JSONB NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT now(),
    region STRING NOT NULL DEFAULT 'us-east',
    
    INDEX idx_node_type_time (node_id, metric_type, timestamp),
    INDEX idx_task_type_time (task_id, metric_type, timestamp),
    INDEX idx_timestamp (timestamp),
    
    PARTITION BY LIST (region) (
        PARTITION us_east VALUES IN ('us-east'),
        PARTITION us_west VALUES IN ('us-west'),
        PARTITION eu VALUES IN ('eu'),
        PARTITION apac VALUES IN ('apac')
    )
) LOCALITY REGIONAL BY ROW;

-- Scheduling decisions log
CREATE TABLE IF NOT EXISTS scheduling_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    score DECIMAL(10, 6) NOT NULL,
    score_components JSONB NOT NULL,
    algorithm STRING NOT NULL DEFAULT 'multi-objective',
    was_successful BOOL NULL,
    execution_time_ms INT NULL,
    region STRING NOT NULL DEFAULT 'us-east',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    
    INDEX idx_task (task_id),
    INDEX idx_node (node_id),
    INDEX idx_created_at (created_at),
    
    PARTITION BY LIST (region) (
        PARTITION us_east VALUES IN ('us-east'),
        PARTITION us_west VALUES IN ('us-west'),
        PARTITION eu VALUES IN ('eu'),
        PARTITION apac VALUES IN ('apac')
    )
) LOCALITY REGIONAL BY ROW;

-- Create views for common queries
CREATE OR REPLACE VIEW v_task_summary AS
SELECT 
    status,
    COUNT(*) as count,
    AVG(execution_time_ms) as avg_execution_time,
    SUM(cost) as total_cost
FROM tasks
GROUP BY status;

CREATE OR REPLACE VIEW v_node_health AS
SELECT 
    n.id,
    n.name,
    n.status,
    n.region,
    n.cpu_usage,
    n.memory_usage,
    n.tasks_running,
    n.max_tasks,
    COUNT(t.id) as pending_tasks,
    n.last_heartbeat
FROM nodes n
LEFT JOIN tasks t ON t.node_id = n.id AND t.status = 'PENDING'
GROUP BY n.id, n.name, n.status, n.region, n.cpu_usage, n.memory_usage, n.tasks_running, n.max_tasks, n.last_heartbeat;

-- Create changefeed for real-time updates (optional)
-- CREATE CHANGEFEED FOR TABLE tasks INTO 'kafka://kafka:9092' WITH updated;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO edgecloud_app;
