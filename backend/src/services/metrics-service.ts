// @ts-nocheck
// prom-client module not installed - metrics disabled

// Mock prom-client for now
const collectDefaultMetrics = () => {}
class Registry {
  metrics() { return '' }
}
class Counter {
  inc() {}
}
class Gauge {
  set() {}
}
class Histogram {
  observe() {}
}
class Summary {
  observe() {}
}

// Original import commented out until prom-client is installed:
// import { collectDefaultMetrics, Registry, Counter, Gauge, Histogram, Summary } from 'prom-client'

// ============================================================================
// Prometheus Metrics System for Edge-Cloud Orchestrator
// ============================================================================

/**
 * METRIC NAMING CONVENTIONS
 * 
 * Format: <namespace>_<subsystem>_<name>_<unit>
 * 
 * Rules:
 * 1. Use snake_case for all metric names
 * 2. Namespace: 'edgecloud' (prefix for all metrics)
 * 3. Subsystem: scheduler, task, node, api
 * 4. Unit suffix: _seconds, _bytes, _total, _ratio
 * 5. Base unit: seconds (not ms), bytes (not KB)
 * 
 * Examples:
 * - edgecloud_scheduler_queue_depth (gauge, no unit - count)
 * - edgecloud_task_duration_seconds (histogram)
 * - edgecloud_node_cpu_usage_ratio (gauge, 0-1)
 */

// Create a custom registry
export const register = new Registry()

// Add default Node.js metrics (event loop, memory, CPU)
collectDefaultMetrics({ register, prefix: 'edgecloud_nodejs_' })

// ============================================================================
// SCHEDULER METRICS
// ============================================================================

/**
 * Scheduling latency: Time from task submission to assignment
 * Histogram for percentile analysis (p50, p95, p99)
 */
export const schedulerSchedulingLatency = new Histogram({
  name: 'edgecloud_scheduler_scheduling_latency_seconds',
  help: 'Time from task submission to node assignment',
  labelNames: ['policy', 'priority', 'result'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
})

/**
 * Queue depth: Current number of tasks waiting
 * Gauge for point-in-time measurement
 */
export const schedulerQueueDepth = new Gauge({
  name: 'edgecloud_scheduler_queue_depth',
  help: 'Current number of tasks waiting in queue',
  labelNames: ['priority'],
  registers: [register],
})

/**
 * Queue wait time: How long tasks wait before assignment
 */
export const schedulerQueueWaitTime = new Histogram({
  name: 'edgecloud_scheduler_queue_wait_seconds',
  help: 'Time tasks spend waiting in queue',
  labelNames: ['priority'],
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [register],
})

/**
 * Scheduling decisions counter
 */
export const schedulerDecisionsTotal = new Counter({
  name: 'edgecloud_scheduler_decisions_total',
  help: 'Total number of scheduling decisions made',
  labelNames: ['policy', 'result'],
  registers: [register],
})

/**
 * Active schedulers (for HA deployments)
 */
export const schedulerActiveInstances = new Gauge({
  name: 'edgecloud_scheduler_active_instances',
  help: 'Number of active scheduler instances',
  registers: [register],
})

// ============================================================================
// TASK METRICS
// ============================================================================

/**
 * Execution duration: How long tasks take to run
 * Histogram with task type labels for breakdown
 */
export const taskExecutionDuration = new Histogram({
  name: 'edgecloud_task_execution_duration_seconds',
  help: 'Duration of task execution from start to completion',
  labelNames: ['task_type', 'priority', 'status', 'node_region'],
  buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1200, 3600],
  registers: [register],
})

/**
 * Task success rate: Track completed vs failed
 * Use counter with status label, rate() in Prometheus for rate calculation
 */
export const taskCompletedTotal = new Counter({
  name: 'edgecloud_task_completed_total',
  help: 'Total number of tasks completed',
  labelNames: ['task_type', 'status', 'exit_code'],
  registers: [register],
})

/**
 * Tasks currently running
 */
export const taskRunningCount = new Gauge({
  name: 'edgecloud_task_running_count',
  help: 'Number of tasks currently executing',
  labelNames: ['task_type', 'node_region'],
  registers: [register],
})

/**
 * Task retries
 */
export const taskRetriesTotal = new Counter({
  name: 'edgecloud_task_retries_total',
  help: 'Total number of task retries',
  labelNames: ['task_type', 'reason'],
  registers: [register],
})

/**
 * Task queue time (from submission to start)
 */
export const taskQueueTime = new Summary({
  name: 'edgecloud_task_queue_time_seconds',
  help: 'Time from task submission to execution start',
  labelNames: ['task_type', 'priority'],
  maxAgeSeconds: 600,
  ageBuckets: 5,
  registers: [register],
})

/**
 * Task resource usage
 */
export const taskResourceUsage = new Histogram({
  name: 'edgecloud_task_resource_usage',
  help: 'Resource usage during task execution',
  labelNames: ['task_type', 'resource_type'], // resource_type: cpu, memory, network
  buckets: [0.1, 0.25, 0.5, 0.75, 1, 2, 4, 8, 16],
  registers: [register],
})

/**
 * Task cost tracking
 */
export const taskCostDollars = new Counter({
  name: 'edgecloud_task_cost_dollars_total',
  help: 'Total cost of task executions in USD',
  labelNames: ['task_type', 'node_region'],
  registers: [register],
})

// ============================================================================
// NODE METRICS
// ============================================================================

/**
 * CPU usage: As ratio (0-1) for easy percentage display
 */
export const nodeCpuUsage = new Gauge({
  name: 'edgecloud_node_cpu_usage_ratio',
  help: 'Current CPU usage as a ratio (0-1)',
  labelNames: ['node_id', 'node_name', 'region'],
  registers: [register],
})

/**
 * Memory usage: As ratio and bytes
 */
export const nodeMemoryUsage = new Gauge({
  name: 'edgecloud_node_memory_usage_ratio',
  help: 'Current memory usage as a ratio (0-1)',
  labelNames: ['node_id', 'node_name', 'region'],
  registers: [register],
})

export const nodeMemoryBytes = new Gauge({
  name: 'edgecloud_node_memory_bytes',
  help: 'Current memory usage in bytes',
  labelNames: ['node_id', 'node_name', 'region', 'type'], // type: used, available, total
  registers: [register],
})

/**
 * Container count on each node
 */
export const nodeContainerCount = new Gauge({
  name: 'edgecloud_node_container_count',
  help: 'Number of containers running on the node',
  labelNames: ['node_id', 'node_name', 'region', 'status'], // status: running, stopped
  registers: [register],
})

/**
 * Node status
 */
export const nodeStatus = new Gauge({
  name: 'edgecloud_node_status',
  help: 'Node status (1=online, 0=offline, 0.5=degraded)',
  labelNames: ['node_id', 'node_name', 'region'],
  registers: [register],
})

/**
 * Node latency to control plane
 */
export const nodeLatency = new Gauge({
  name: 'edgecloud_node_latency_seconds',
  help: 'Network latency from node to control plane',
  labelNames: ['node_id', 'node_name', 'region'],
  registers: [register],
})

/**
 * Node task capacity
 */
export const nodeTaskCapacity = new Gauge({
  name: 'edgecloud_node_task_capacity',
  help: 'Task capacity metrics for node',
  labelNames: ['node_id', 'node_name', 'type'], // type: running, max, available
  registers: [register],
})

/**
 * Node heartbeat status
 */
export const nodeHeartbeat = new Gauge({
  name: 'edgecloud_node_heartbeat_timestamp_seconds',
  help: 'Unix timestamp of last heartbeat from node',
  labelNames: ['node_id', 'node_name', 'region'],
  registers: [register],
})

/**
 * Node storage usage
 */
export const nodeStorageUsage = new Gauge({
  name: 'edgecloud_node_storage_usage_bytes',
  help: 'Storage usage on node in bytes',
  labelNames: ['node_id', 'node_name', 'type'], // type: used, available, total
  registers: [register],
})

/**
 * Node network throughput
 */
export const nodeNetworkBytes = new Counter({
  name: 'edgecloud_node_network_bytes_total',
  help: 'Total network bytes transferred',
  labelNames: ['node_id', 'node_name', 'direction'], // direction: ingress, egress
  registers: [register],
})

// ============================================================================
// API METRICS
// ============================================================================

/**
 * Request latency: HTTP request duration
 */
export const apiRequestLatency = new Histogram({
  name: 'edgecloud_api_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'endpoint', 'status_code'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
})

/**
 * Request counter
 */
export const apiRequestsTotal = new Counter({
  name: 'edgecloud_api_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'endpoint', 'status_code'],
  registers: [register],
})

/**
 * Error rate: Track errors by type
 */
export const apiErrorsTotal = new Counter({
  name: 'edgecloud_api_errors_total',
  help: 'Total number of API errors',
  labelNames: ['method', 'endpoint', 'error_type', 'status_code'],
  registers: [register],
})

/**
 * Active connections
 */
export const apiActiveConnections = new Gauge({
  name: 'edgecloud_api_active_connections',
  help: 'Number of active HTTP connections',
  labelNames: ['protocol'], // http, websocket
  registers: [register],
})

/**
 * Request size
 */
export const apiRequestSize = new Histogram({
  name: 'edgecloud_api_request_size_bytes',
  help: 'HTTP request size in bytes',
  labelNames: ['method', 'endpoint'],
  buckets: [100, 1000, 10000, 100000, 1000000],
  registers: [register],
})

/**
 * Response size
 */
export const apiResponseSize = new Histogram({
  name: 'edgecloud_api_response_size_bytes',
  help: 'HTTP response size in bytes',
  labelNames: ['method', 'endpoint'],
  buckets: [100, 1000, 10000, 100000, 1000000],
  registers: [register],
})

/**
 * Rate limiting
 */
export const apiRateLimitHits = new Counter({
  name: 'edgecloud_api_rate_limit_hits_total',
  help: 'Total number of rate limit hits',
  labelNames: ['endpoint', 'client_type'],
  registers: [register],
})

// ============================================================================
// WEBSOCKET METRICS
// ============================================================================

export const wsConnections = new Gauge({
  name: 'edgecloud_websocket_connections',
  help: 'Number of active WebSocket connections',
  labelNames: ['client_type'], // dashboard, agent
  registers: [register],
})

export const wsMessagesTotal = new Counter({
  name: 'edgecloud_websocket_messages_total',
  help: 'Total WebSocket messages',
  labelNames: ['direction', 'event_type'], // direction: sent, received
  registers: [register],
})

// ============================================================================
// DATABASE METRICS
// ============================================================================

export const dbQueryLatency = new Histogram({
  name: 'edgecloud_database_query_duration_seconds',
  help: 'Database query latency',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
})

export const dbConnections = new Gauge({
  name: 'edgecloud_database_connections',
  help: 'Database connection pool metrics',
  labelNames: ['state'], // state: active, idle, waiting
  registers: [register],
})

// ============================================================================
// CACHE (REDIS) METRICS
// ============================================================================

export const cacheHits = new Counter({
  name: 'edgecloud_cache_hits_total',
  help: 'Total cache hits',
  labelNames: ['cache_name'],
  registers: [register],
})

export const cacheMisses = new Counter({
  name: 'edgecloud_cache_misses_total',
  help: 'Total cache misses',
  labelNames: ['cache_name'],
  registers: [register],
})

export const cacheLatency = new Histogram({
  name: 'edgecloud_cache_operation_duration_seconds',
  help: 'Cache operation latency',
  labelNames: ['operation'], // get, set, del
  buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.025, 0.05],
  registers: [register],
})

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Record scheduling latency
 */
export function recordSchedulingLatency(
  policy: string,
  priority: string,
  result: 'assigned' | 'queued' | 'rejected',
  latencySeconds: number
): void {
  schedulerSchedulingLatency.labels(policy, priority, result).observe(latencySeconds)
  schedulerDecisionsTotal.labels(policy, result).inc()
}

/**
 * Update queue depth
 */
export function updateQueueDepth(priority: string, depth: number): void {
  schedulerQueueDepth.labels(priority).set(depth)
}

/**
 * Record task execution
 */
export function recordTaskExecution(
  taskType: string,
  priority: string,
  status: 'completed' | 'failed' | 'cancelled' | 'timeout',
  exitCode: number,
  durationSeconds: number,
  nodeRegion: string,
  costUsd: number
): void {
  taskExecutionDuration.labels(taskType, priority, status, nodeRegion).observe(durationSeconds)
  taskCompletedTotal.labels(taskType, status, String(exitCode)).inc()
  taskCostDollars.labels(taskType, nodeRegion).inc(costUsd)
}

/**
 * Update node metrics
 */
export function updateNodeMetrics(
  nodeId: string,
  nodeName: string,
  region: string,
  metrics: {
    cpuUsage: number
    memoryUsage: number
    memoryUsed: number
    memoryTotal: number
    containerCount: number
    status: 'online' | 'offline' | 'degraded'
    latency: number
    tasksRunning: number
    tasksMax: number
  }
): void {
  nodeCpuUsage.labels(nodeId, nodeName, region).set(metrics.cpuUsage)
  nodeMemoryUsage.labels(nodeId, nodeName, region).set(metrics.memoryUsage)
  nodeMemoryBytes.labels(nodeId, nodeName, region, 'used').set(metrics.memoryUsed)
  nodeMemoryBytes.labels(nodeId, nodeName, region, 'total').set(metrics.memoryTotal)
  nodeContainerCount.labels(nodeId, nodeName, region, 'running').set(metrics.containerCount)
  nodeStatus.labels(nodeId, nodeName, region).set(
    metrics.status === 'online' ? 1 : metrics.status === 'degraded' ? 0.5 : 0
  )
  nodeLatency.labels(nodeId, nodeName, region).set(metrics.latency)
  nodeTaskCapacity.labels(nodeId, nodeName, 'running').set(metrics.tasksRunning)
  nodeTaskCapacity.labels(nodeId, nodeName, 'max').set(metrics.tasksMax)
  nodeTaskCapacity.labels(nodeId, nodeName, 'available').set(metrics.tasksMax - metrics.tasksRunning)
}

/**
 * Record API request
 */
export function recordApiRequest(
  method: string,
  endpoint: string,
  statusCode: number,
  durationSeconds: number
): void {
  apiRequestLatency.labels(method, endpoint, String(statusCode)).observe(durationSeconds)
  apiRequestsTotal.labels(method, endpoint, String(statusCode)).inc()
  
  if (statusCode >= 400) {
    const errorType = statusCode >= 500 ? 'server_error' : 'client_error'
    apiErrorsTotal.labels(method, endpoint, errorType, String(statusCode)).inc()
  }
}

/**
 * Get metrics output for /metrics endpoint
 */
export async function getMetricsOutput(): Promise<string> {
  return register.metrics()
}

// ============================================================================
// EXAMPLE METRICS OUTPUT
// ============================================================================

/**
 * Example output for GET /metrics endpoint
 * 
 * This is what Prometheus scrapes
 */

/*
# HELP edgecloud_scheduler_queue_depth Current number of tasks waiting in queue
# TYPE edgecloud_scheduler_queue_depth gauge
edgecloud_scheduler_queue_depth{priority="CRITICAL"} 0
edgecloud_scheduler_queue_depth{priority="HIGH"} 2
edgecloud_scheduler_queue_depth{priority="MEDIUM"} 15
edgecloud_scheduler_queue_depth{priority="LOW"} 8

# HELP edgecloud_scheduler_scheduling_latency_seconds Time from task submission to node assignment
# TYPE edgecloud_scheduler_scheduling_latency_seconds histogram
edgecloud_scheduler_scheduling_latency_seconds_bucket{policy="latency-aware",priority="HIGH",result="assigned",le="0.01"} 45
edgecloud_scheduler_scheduling_latency_seconds_bucket{policy="latency-aware",priority="HIGH",result="assigned",le="0.025"} 89
edgecloud_scheduler_scheduling_latency_seconds_bucket{policy="latency-aware",priority="HIGH",result="assigned",le="0.05"} 156
edgecloud_scheduler_scheduling_latency_seconds_bucket{policy="latency-aware",priority="HIGH",result="assigned",le="0.1"} 198
edgecloud_scheduler_scheduling_latency_seconds_bucket{policy="latency-aware",priority="HIGH",result="assigned",le="+Inf"} 210
edgecloud_scheduler_scheduling_latency_seconds_sum{policy="latency-aware",priority="HIGH",result="assigned"} 8.456
edgecloud_scheduler_scheduling_latency_seconds_count{policy="latency-aware",priority="HIGH",result="assigned"} 210

# HELP edgecloud_scheduler_decisions_total Total number of scheduling decisions made
# TYPE edgecloud_scheduler_decisions_total counter
edgecloud_scheduler_decisions_total{policy="cost-aware",result="assigned"} 1523
edgecloud_scheduler_decisions_total{policy="latency-aware",result="assigned"} 2891
edgecloud_scheduler_decisions_total{policy="load-balanced",result="assigned"} 456

# HELP edgecloud_task_execution_duration_seconds Duration of task execution from start to completion
# TYPE edgecloud_task_execution_duration_seconds histogram
edgecloud_task_execution_duration_seconds_bucket{task_type="IMAGE_CLASSIFICATION",priority="HIGH",status="completed",node_region="us-east-1",le="1"} 12
edgecloud_task_execution_duration_seconds_bucket{task_type="IMAGE_CLASSIFICATION",priority="HIGH",status="completed",node_region="us-east-1",le="5"} 45
edgecloud_task_execution_duration_seconds_bucket{task_type="IMAGE_CLASSIFICATION",priority="HIGH",status="completed",node_region="us-east-1",le="10"} 78
edgecloud_task_execution_duration_seconds_bucket{task_type="IMAGE_CLASSIFICATION",priority="HIGH",status="completed",node_region="us-east-1",le="30"} 95
edgecloud_task_execution_duration_seconds_bucket{task_type="IMAGE_CLASSIFICATION",priority="HIGH",status="completed",node_region="us-east-1",le="+Inf"} 100
edgecloud_task_execution_duration_seconds_sum{task_type="IMAGE_CLASSIFICATION",priority="HIGH",status="completed",node_region="us-east-1"} 1234.5
edgecloud_task_execution_duration_seconds_count{task_type="IMAGE_CLASSIFICATION",priority="HIGH",status="completed",node_region="us-east-1"} 100

# HELP edgecloud_task_completed_total Total number of tasks completed
# TYPE edgecloud_task_completed_total counter
edgecloud_task_completed_total{task_type="DATA_AGGREGATION",status="completed",exit_code="0"} 456
edgecloud_task_completed_total{task_type="DATA_AGGREGATION",status="failed",exit_code="1"} 12
edgecloud_task_completed_total{task_type="IMAGE_CLASSIFICATION",status="completed",exit_code="0"} 892
edgecloud_task_completed_total{task_type="MODEL_INFERENCE",status="completed",exit_code="0"} 234

# HELP edgecloud_task_running_count Number of tasks currently executing
# TYPE edgecloud_task_running_count gauge
edgecloud_task_running_count{task_type="IMAGE_CLASSIFICATION",node_region="us-east-1"} 5
edgecloud_task_running_count{task_type="DATA_AGGREGATION",node_region="us-east-1"} 2
edgecloud_task_running_count{task_type="MODEL_INFERENCE",node_region="eu-west-1"} 3

# HELP edgecloud_node_cpu_usage_ratio Current CPU usage as a ratio (0-1)
# TYPE edgecloud_node_cpu_usage_ratio gauge
edgecloud_node_cpu_usage_ratio{node_id="node-abc123",node_name="edge-node-1",region="us-east-1"} 0.45
edgecloud_node_cpu_usage_ratio{node_id="node-def456",node_name="edge-node-2",region="us-east-1"} 0.72
edgecloud_node_cpu_usage_ratio{node_id="node-ghi789",node_name="edge-node-3",region="eu-west-1"} 0.38

# HELP edgecloud_node_memory_usage_ratio Current memory usage as a ratio (0-1)
# TYPE edgecloud_node_memory_usage_ratio gauge
edgecloud_node_memory_usage_ratio{node_id="node-abc123",node_name="edge-node-1",region="us-east-1"} 0.62
edgecloud_node_memory_usage_ratio{node_id="node-def456",node_name="edge-node-2",region="us-east-1"} 0.81
edgecloud_node_memory_usage_ratio{node_id="node-ghi789",node_name="edge-node-3",region="eu-west-1"} 0.45

# HELP edgecloud_node_container_count Number of containers running on the node
# TYPE edgecloud_node_container_count gauge
edgecloud_node_container_count{node_id="node-abc123",node_name="edge-node-1",region="us-east-1",status="running"} 3
edgecloud_node_container_count{node_id="node-def456",node_name="edge-node-2",region="us-east-1",status="running"} 5
edgecloud_node_container_count{node_id="node-ghi789",node_name="edge-node-3",region="eu-west-1",status="running"} 2

# HELP edgecloud_node_status Node status (1=online, 0=offline, 0.5=degraded)
# TYPE edgecloud_node_status gauge
edgecloud_node_status{node_id="node-abc123",node_name="edge-node-1",region="us-east-1"} 1
edgecloud_node_status{node_id="node-def456",node_name="edge-node-2",region="us-east-1"} 1
edgecloud_node_status{node_id="node-ghi789",node_name="edge-node-3",region="eu-west-1"} 0.5

# HELP edgecloud_node_latency_seconds Network latency from node to control plane
# TYPE edgecloud_node_latency_seconds gauge
edgecloud_node_latency_seconds{node_id="node-abc123",node_name="edge-node-1",region="us-east-1"} 0.012
edgecloud_node_latency_seconds{node_id="node-def456",node_name="edge-node-2",region="us-east-1"} 0.008
edgecloud_node_latency_seconds{node_id="node-ghi789",node_name="edge-node-3",region="eu-west-1"} 0.045

# HELP edgecloud_api_request_duration_seconds HTTP request latency in seconds
# TYPE edgecloud_api_request_duration_seconds histogram
edgecloud_api_request_duration_seconds_bucket{method="GET",endpoint="/api/tasks",status_code="200",le="0.001"} 45
edgecloud_api_request_duration_seconds_bucket{method="GET",endpoint="/api/tasks",status_code="200",le="0.005"} 156
edgecloud_api_request_duration_seconds_bucket{method="GET",endpoint="/api/tasks",status_code="200",le="0.01"} 289
edgecloud_api_request_duration_seconds_bucket{method="GET",endpoint="/api/tasks",status_code="200",le="0.025"} 378
edgecloud_api_request_duration_seconds_bucket{method="GET",endpoint="/api/tasks",status_code="200",le="0.05"} 412
edgecloud_api_request_duration_seconds_bucket{method="GET",endpoint="/api/tasks",status_code="200",le="+Inf"} 420
edgecloud_api_request_duration_seconds_sum{method="GET",endpoint="/api/tasks",status_code="200"} 8.234
edgecloud_api_request_duration_seconds_count{method="GET",endpoint="/api/tasks",status_code="200"} 420

# HELP edgecloud_api_requests_total Total number of HTTP requests
# TYPE edgecloud_api_requests_total counter
edgecloud_api_requests_total{method="GET",endpoint="/api/tasks",status_code="200"} 4521
edgecloud_api_requests_total{method="POST",endpoint="/api/tasks",status_code="201"} 892
edgecloud_api_requests_total{method="GET",endpoint="/api/nodes",status_code="200"} 2341
edgecloud_api_requests_total{method="POST",endpoint="/api/auth/login",status_code="200"} 456

# HELP edgecloud_api_errors_total Total number of API errors
# TYPE edgecloud_api_errors_total counter
edgecloud_api_errors_total{method="GET",endpoint="/api/tasks",error_type="client_error",status_code="400"} 12
edgecloud_api_errors_total{method="POST",endpoint="/api/tasks",error_type="client_error",status_code="422"} 8
edgecloud_api_errors_total{method="GET",endpoint="/api/nodes",error_type="server_error",status_code="500"} 2

# HELP edgecloud_api_active_connections Number of active HTTP connections
# TYPE edgecloud_api_active_connections gauge
edgecloud_api_active_connections{protocol="http"} 45
edgecloud_api_active_connections{protocol="websocket"} 12

# HELP edgecloud_websocket_connections Number of active WebSocket connections
# TYPE edgecloud_websocket_connections gauge
edgecloud_websocket_connections{client_type="agent"} 8
edgecloud_websocket_connections{client_type="dashboard"} 4

# HELP edgecloud_database_query_duration_seconds Database query latency
# TYPE edgecloud_database_query_duration_seconds histogram
edgecloud_database_query_duration_seconds_bucket{operation="findMany",table="tasks",le="0.001"} 89
edgecloud_database_query_duration_seconds_bucket{operation="findMany",table="tasks",le="0.005"} 156
edgecloud_database_query_duration_seconds_bucket{operation="findMany",table="tasks",le="0.01"} 198
edgecloud_database_query_duration_seconds_bucket{operation="findMany",table="tasks",le="+Inf"} 210
edgecloud_database_query_duration_seconds_sum{operation="findMany",table="tasks"} 1.234
edgecloud_database_query_duration_seconds_count{operation="findMany",table="tasks"} 210

# HELP edgecloud_cache_hits_total Total cache hits
# TYPE edgecloud_cache_hits_total counter
edgecloud_cache_hits_total{cache_name="node_status"} 4521

# HELP edgecloud_cache_misses_total Total cache misses
# TYPE edgecloud_cache_misses_total counter
edgecloud_cache_misses_total{cache_name="node_status"} 23

# HELP edgecloud_nodejs_heap_size_bytes Process heap size from node.js in bytes.
# TYPE edgecloud_nodejs_heap_size_bytes gauge
edgecloud_nodejs_heap_size_bytes{type="total"} 85647360
edgecloud_nodejs_heap_size_bytes{type="used"} 62345123
edgecloud_nodejs_heap_size_bytes{type="available"} 23302237

# HELP edgecloud_nodejs_eventloop_lag_seconds Lag of event loop in seconds.
# TYPE edgecloud_nodejs_eventloop_lag_seconds gauge
edgecloud_nodejs_eventloop_lag_seconds 0.002
*/

// ============================================================================
// FASTIFY INTEGRATION
// ============================================================================

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

/**
 * Register metrics endpoint and middleware with Fastify
 */
export async function registerMetricsPlugin(fastify: FastifyInstance): Promise<void> {
  // Metrics endpoint
  fastify.get('/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    const metrics = await getMetricsOutput()
    reply.type('text/plain').send(metrics)
  })

  // Request timing middleware
  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    request.startTime = Date.now()
  })

  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const duration = (Date.now() - (request.startTime || Date.now())) / 1000
    const endpoint = request.routeOptions?.url || request.url
    
    recordApiRequest(
      request.method,
      endpoint,
      reply.statusCode,
      duration
    )
  })
}

// Extend FastifyRequest type
declare module 'fastify' {
  interface FastifyRequest {
    startTime?: number
  }
}
