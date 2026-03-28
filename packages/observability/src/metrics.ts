import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { EventEmitter } from 'eventemitter3';

export interface MetricsConfig {
  serviceName: string;
  serviceVersion: string;
  collectDefaults?: boolean;
  prefix?: string;
}

export class MetricsCollector extends EventEmitter {
  public readonly registry: Registry;
  private config: MetricsConfig;

  // Task metrics
  public readonly tasksCreated: Counter;
  public readonly tasksScheduled: Counter;
  public readonly tasksCompleted: Counter;
  public readonly tasksFailed: Counter;
  public readonly tasksCancelled: Counter;
  public readonly taskDuration: Histogram;
  public readonly taskQueueTime: Histogram;

  // Node metrics
  public readonly nodeRegistrations: Counter;
  public readonly nodeHeartbeats: Counter;
  public readonly nodeFailures: Counter;
  public readonly activeNodes: Gauge;
  public readonly nodeCpuUsage: Gauge;
  public readonly nodeMemoryUsage: Gauge;

  // Scheduler metrics
  public readonly schedulingDecisions: Counter;
  public readonly schedulingDuration: Histogram;
  public readonly schedulerLeader: Gauge;

  // RAFT metrics
  public readonly raftStateChanges: Counter;
  public readonly raftElections: Counter;
  public readonly raftLogEntries: Counter;
  public readonly raftCommitIndex: Gauge;

  // API metrics
  public readonly httpRequestsTotal: Counter;
  public readonly httpRequestDuration: Histogram;
  public readonly httpActiveRequests: Gauge;

  // Event bus metrics
  public readonly eventsPublished: Counter;
  public readonly eventsConsumed: Counter;
  public readonly eventProcessingDuration: Histogram;
  public readonly eventLag: Gauge;

  // Database metrics
  public readonly dbQueryDuration: Histogram;
  public readonly dbConnections: Gauge;
  public readonly dbConnectionErrors: Counter;

  constructor(config: MetricsConfig) {
    super();
    this.config = config;
    this.registry = new Registry();

    // Set default labels
    this.registry.setDefaultLabels({
      service: config.serviceName,
      version: config.serviceVersion,
    });

    // Collect default Node.js metrics
    if (config.collectDefaults !== false) {
      collectDefaultMetrics({ register: this.registry });
    }

    const prefix = config.prefix || 'edgecloud';

    // Initialize task metrics
    this.tasksCreated = new Counter({
      name: `${prefix}_tasks_created_total`,
      help: 'Total number of tasks created',
      labelNames: ['type', 'priority', 'region'],
      registers: [this.registry],
    });

    this.tasksScheduled = new Counter({
      name: `${prefix}_tasks_scheduled_total`,
      help: 'Total number of tasks scheduled',
      labelNames: ['node_id', 'algorithm'],
      registers: [this.registry],
    });

    this.tasksCompleted = new Counter({
      name: `${prefix}_tasks_completed_total`,
      help: 'Total number of tasks completed',
      labelNames: ['node_id', 'status'],
      registers: [this.registry],
    });

    this.tasksFailed = new Counter({
      name: `${prefix}_tasks_failed_total`,
      help: 'Total number of tasks failed',
      labelNames: ['node_id', 'error_type', 'retry_count'],
      registers: [this.registry],
    });

    this.tasksCancelled = new Counter({
      name: `${prefix}_tasks_cancelled_total`,
      help: 'Total number of tasks cancelled',
      labelNames: ['reason'],
      registers: [this.registry],
    });

    this.taskDuration = new Histogram({
      name: `${prefix}_task_duration_seconds`,
      help: 'Task execution duration in seconds',
      labelNames: ['type', 'node_id'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
      registers: [this.registry],
    });

    this.taskQueueTime = new Histogram({
      name: `${prefix}_task_queue_duration_seconds`,
      help: 'Time tasks spend in queue',
      labelNames: ['type', 'priority'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
      registers: [this.registry],
    });

    // Initialize node metrics
    this.nodeRegistrations = new Counter({
      name: `${prefix}_node_registrations_total`,
      help: 'Total number of node registrations',
      labelNames: ['region'],
      registers: [this.registry],
    });

    this.nodeHeartbeats = new Counter({
      name: `${prefix}_node_heartbeats_total`,
      help: 'Total number of node heartbeats received',
      labelNames: ['node_id', 'region'],
      registers: [this.registry],
    });

    this.nodeFailures = new Counter({
      name: `${prefix}_node_failures_total`,
      help: 'Total number of node failures',
      labelNames: ['node_id', 'reason'],
      registers: [this.registry],
    });

    this.activeNodes = new Gauge({
      name: `${prefix}_active_nodes`,
      help: 'Number of currently active nodes',
      labelNames: ['region', 'status'],
      registers: [this.registry],
    });

    this.nodeCpuUsage = new Gauge({
      name: `${prefix}_node_cpu_usage_percent`,
      help: 'CPU usage percentage per node',
      labelNames: ['node_id', 'region'],
      registers: [this.registry],
    });

    this.nodeMemoryUsage = new Gauge({
      name: `${prefix}_node_memory_usage_percent`,
      help: 'Memory usage percentage per node',
      labelNames: ['node_id', 'region'],
      registers: [this.registry],
    });

    // Initialize scheduler metrics
    this.schedulingDecisions = new Counter({
      name: `${prefix}_scheduling_decisions_total`,
      help: 'Total number of scheduling decisions',
      labelNames: ['algorithm', 'result'],
      registers: [this.registry],
    });

    this.schedulingDuration = new Histogram({
      name: `${prefix}_scheduling_duration_seconds`,
      help: 'Time taken to make scheduling decisions',
      labelNames: ['algorithm'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
      registers: [this.registry],
    });

    this.schedulerLeader = new Gauge({
      name: `${prefix}_scheduler_leader`,
      help: 'Whether this scheduler instance is the leader (1) or not (0)',
      labelNames: ['node_id'],
      registers: [this.registry],
    });

    // Initialize RAFT metrics
    this.raftStateChanges = new Counter({
      name: `${prefix}_raft_state_changes_total`,
      help: 'Total number of RAFT state changes',
      labelNames: ['from_state', 'to_state'],
      registers: [this.registry],
    });

    this.raftElections = new Counter({
      name: `${prefix}_raft_elections_total`,
      help: 'Total number of RAFT elections',
      labelNames: ['result'],
      registers: [this.registry],
    });

    this.raftLogEntries = new Counter({
      name: `${prefix}_raft_log_entries_total`,
      help: 'Total number of RAFT log entries',
      labelNames: ['operation'],
      registers: [this.registry],
    });

    this.raftCommitIndex = new Gauge({
      name: `${prefix}_raft_commit_index`,
      help: 'Current RAFT commit index',
      labelNames: ['node_id'],
      registers: [this.registry],
    });

    // Initialize API metrics
    this.httpRequestsTotal = new Counter({
      name: `${prefix}_http_requests_total`,
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: `${prefix}_http_request_duration_seconds`,
      help: 'HTTP request duration',
      labelNames: ['method', 'route'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.httpActiveRequests = new Gauge({
      name: `${prefix}_http_active_requests`,
      help: 'Number of active HTTP requests',
      labelNames: ['method', 'route'],
      registers: [this.registry],
    });

    // Initialize event bus metrics
    this.eventsPublished = new Counter({
      name: `${prefix}_events_published_total`,
      help: 'Total events published',
      labelNames: ['topic', 'event_type'],
      registers: [this.registry],
    });

    this.eventsConsumed = new Counter({
      name: `${prefix}_events_consumed_total`,
      help: 'Total events consumed',
      labelNames: ['topic', 'consumer_group'],
      registers: [this.registry],
    });

    this.eventProcessingDuration = new Histogram({
      name: `${prefix}_event_processing_duration_seconds`,
      help: 'Event processing duration',
      labelNames: ['topic', 'event_type'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
      registers: [this.registry],
    });

    this.eventLag = new Gauge({
      name: `${prefix}_event_lag_seconds`,
      help: 'Consumer lag in seconds',
      labelNames: ['topic', 'consumer_group', 'partition'],
      registers: [this.registry],
    });

    // Initialize database metrics
    this.dbQueryDuration = new Histogram({
      name: `${prefix}_db_query_duration_seconds`,
      help: 'Database query duration',
      labelNames: ['operation', 'table'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
      registers: [this.registry],
    });

    this.dbConnections = new Gauge({
      name: `${prefix}_db_connections`,
      help: 'Number of database connections',
      labelNames: ['state'],
      registers: [this.registry],
    });

    this.dbConnectionErrors = new Counter({
      name: `${prefix}_db_connection_errors_total`,
      help: 'Total database connection errors',
      labelNames: ['error_type'],
      registers: [this.registry],
    });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }

  // Helper methods for common metric updates
  recordTaskCreated(type: string, priority: string, region: string): void {
    this.tasksCreated.inc({ type, priority, region });
  }

  recordTaskScheduled(nodeId: string, algorithm: string): void {
    this.tasksScheduled.inc({ node_id: nodeId, algorithm });
  }

  recordTaskCompleted(nodeId: string, status: string, durationSeconds: number, type: string): void {
    this.tasksCompleted.inc({ node_id: nodeId, status });
    this.taskDuration.observe({ type, node_id: nodeId }, durationSeconds);
  }

  recordTaskFailed(nodeId: string, errorType: string, retryCount: number): void {
    this.tasksFailed.inc({ node_id: nodeId, error_type: errorType, retry_count: retryCount.toString() });
  }

  recordNodeHeartbeat(nodeId: string, region: string, cpuUsage: number, memoryUsage: number): void {
    this.nodeHeartbeats.inc({ node_id: nodeId, region });
    this.nodeCpuUsage.set({ node_id: nodeId, region }, cpuUsage);
    this.nodeMemoryUsage.set({ node_id: nodeId, region }, memoryUsage);
  }

  recordSchedulingDecision(algorithm: string, result: string, durationSeconds: number): void {
    this.schedulingDecisions.inc({ algorithm, result });
    this.schedulingDuration.observe({ algorithm }, durationSeconds);
  }

  recordHttpRequest(method: string, route: string, statusCode: number, durationSeconds: number): void {
    this.httpRequestsTotal.inc({ method, route, status_code: statusCode.toString() });
    this.httpRequestDuration.observe({ method, route }, durationSeconds);
  }

  recordEventPublished(topic: string, eventType: string): void {
    this.eventsPublished.inc({ topic, event_type: eventType });
  }

  recordEventConsumed(topic: string, consumerGroup: string, durationSeconds: number): void {
    this.eventsConsumed.inc({ topic, consumer_group: consumerGroup });
    this.eventProcessingDuration.observe({ topic, event_type: 'unknown' }, durationSeconds);
  }

  recordDbQuery(operation: string, table: string, durationSeconds: number): void {
    this.dbQueryDuration.observe({ operation, table }, durationSeconds);
  }

  updateActiveNodes(count: number, region: string, status: string): void {
    this.activeNodes.set({ region, status }, count);
  }

  setSchedulerLeader(nodeId: string, isLeader: boolean): void {
    this.schedulerLeader.set({ node_id: nodeId }, isLeader ? 1 : 0);
  }

  updateRaftCommitIndex(nodeId: string, index: number): void {
    this.raftCommitIndex.set({ node_id: nodeId }, index);
  }
}
