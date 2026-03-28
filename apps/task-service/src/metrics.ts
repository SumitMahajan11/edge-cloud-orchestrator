import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { FastifyRequest, FastifyReply } from 'fastify';

// Create registry
const registry = new Registry();

// Set default labels
registry.setDefaultLabels({
  service: 'task-service',
  version: '2.0.0',
});

// Collect default Node.js metrics
collectDefaultMetrics({ register: registry });

// Task metrics
export const tasksCreated = new Counter({
  name: 'edgecloud_tasks_created_total',
  help: 'Total number of tasks created',
  labelNames: ['type', 'priority', 'region'],
  registers: [registry],
});

export const tasksCompleted = new Counter({
  name: 'edgecloud_tasks_completed_total',
  help: 'Total number of tasks completed',
  labelNames: ['status'],
  registers: [registry],
});

export const tasksFailed = new Counter({
  name: 'edgecloud_tasks_failed_total',
  help: 'Total number of tasks failed',
  labelNames: ['error_type'],
  registers: [registry],
});

export const taskDuration = new Histogram({
  name: 'edgecloud_task_duration_seconds',
  help: 'Task execution duration in seconds',
  labelNames: ['type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [registry],
});

export const taskQueueSize = new Gauge({
  name: 'edgecloud_task_queue_size',
  help: 'Current size of task queue',
  labelNames: ['status'],
  registers: [registry],
});

// Database metrics
export const dbQueryDuration = new Histogram({
  name: 'edgecloud_db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});

export const dbConnections = new Gauge({
  name: 'edgecloud_db_connections',
  help: 'Database connection pool metrics',
  labelNames: ['state'],
  registers: [registry],
});

// API metrics
export const httpRequestsTotal = new Counter({
  name: 'edgecloud_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: 'edgecloud_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [registry],
});

// Register metrics function
export function registerMetrics() {
  // Metrics are already registered via the registry
}

// Metrics endpoint handler
export async function metricsEndpoint(request: FastifyRequest, reply: FastifyReply) {
  reply.type('text/plain');
  return registry.metrics();
}

// Helper to record task creation
export function recordTaskCreated(type: string, priority: string, region: string) {
  tasksCreated.inc({ type, priority, region });
}

// Helper to record task completion
export function recordTaskCompleted(status: string) {
  tasksCompleted.inc({ status });
}

// Helper to record task failure
export function recordTaskFailed(errorType: string) {
  tasksFailed.inc({ error_type: errorType });
}

// Helper to update queue size
export function updateQueueSize(status: string, size: number) {
  taskQueueSize.set({ status }, size);
}
