-- CockroachDB Multi-Region Configuration
-- This script configures the database for multi-region deployment

-- Enable enterprise features (required for multi-region)
SET CLUSTER SETTING cluster.organization = 'EdgeCloud Inc';
SET CLUSTER SETTING enterprise.license = 'YOUR_LICENSE_KEY';

-- Add regions to the cluster
ALTER DATABASE edgecloud ADD REGION 'us-east';
ALTER DATABASE edgecloud ADD REGION 'us-west';
ALTER DATABASE edgecloud ADD REGION 'eu-west';
ALTER DATABASE edgecloud ADD REGION 'ap-south';

-- Set the primary region
ALTER DATABASE edgecloud SET PRIMARY REGION 'us-east';

-- Configure survival goals
-- ZONE survival = survive zone failure (default)
-- REGION survival = survive region failure (requires 3+ regions)
ALTER DATABASE edgecloud SURVIVE REGION FAILURE;

-- Update tables for multi-region

-- Tasks table - regional by row (data stays in user's region)
ALTER TABLE tasks SET LOCALITY REGIONAL BY ROW;

-- Nodes table - global (fast reads from any region, slower writes)
ALTER TABLE nodes SET LOCALITY GLOBAL;

-- Task executions - regional by row
ALTER TABLE task_executions SET LOCALITY REGIONAL BY ROW;

-- Metrics - partitioned by time and region
ALTER TABLE metrics SET LOCALITY REGIONAL BY ROW;

-- Scheduling decisions - regional by row
ALTER TABLE scheduling_decisions SET LOCALITY REGIONAL BY ROW;

-- Create follower read timestamps for low-latency reads
-- This allows reading from local replicas with slight staleness
ALTER DATABASE edgecloud SET DEFAULT FOLLOWER READ TIMESTAMP INTERVAL '5s';

-- Configure lease preferences for better latency
-- Nodes will try to get leases in their local region
ALTER TABLE nodes CONFIGURE ZONE USING
    num_replicas = 5,
    constraints = '{"+region=us-east": 2, "+region=us-west": 1, "+region=eu-west": 1, "+region=ap-south": 1}',
    lease_preferences = '[[+region=us-east], [+region=us-west], [+region=eu-west], [+region=ap-south]]';

-- Create views for cross-region monitoring
CREATE OR REPLACE VIEW v_regional_task_distribution AS
SELECT 
    region,
    status,
    COUNT(*) as count,
    AVG(execution_time_ms) as avg_execution_time
FROM tasks
GROUP BY region, status;

CREATE OR REPLACE VIEW v_cross_region_latency AS
SELECT 
    n1.region as from_region,
    n2.region as to_region,
    AVG(n2.latency) as avg_latency
FROM nodes n1
CROSS JOIN nodes n2
WHERE n1.region != n2.region
GROUP BY n1.region, n2.region;
