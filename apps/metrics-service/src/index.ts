import { 
  initTelemetry, 
  createLogger, 
  fastifyLoggingPlugin,
  GracefulShutdown,
  HealthCheck
} from '@edgecloud/shared-kernel';
initTelemetry('metrics-service');

const logger = createLogger('metrics-service');

import Fastify from 'fastify';
import { Registry, collectDefaultMetrics, Gauge, Histogram, Counter } from 'prom-client';
import Redis from 'ioredis';

const app = Fastify({ logger: false });

// Redis for stream monitoring
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: true,
});

// Prometheus Registry
const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'metrics_service_' });

// Custom Business Metrics (Aggregated from other services)
const activeNodesGauge = new Gauge({
  name: 'active_edge_nodes_total',
  help: 'Total number of active edge nodes',
  registers: [registry],
});

const pendingTasksGauge = new Gauge({
  name: 'pending_tasks_total',
  help: 'Total number of tasks in pending state',
  registers: [registry],
});

const schedulingDecisionHistogram = new Histogram({
  name: 'scheduling_decision_duration_ms',
  help: 'Duration of scheduling decisions in ms',
  buckets: [10, 50, 100, 200, 500, 1000],
  registers: [registry],
});

const taskCompletionsCounter = new Counter({
  name: 'task_completions_total',
  help: 'Total number of task completions',
  labelNames: ['status'],
  registers: [registry],
});

const systemLoadGauge = new Gauge({
  name: 'system_load_score',
  help: 'Current system backpressure score (0.0-1.0)',
  registers: [registry],
});

const eventConsumerLagGauge = new Gauge({
  name: 'event_consumer_lag',
  help: 'Lag of Redis Streams consumer groups',
  labelNames: ['stream', 'group'],
  registers: [registry],
});

// Service Configuration
const SERVICES = {
  api: process.env.API_URL || 'http://api:3000',
  task: process.env.TASK_SERVICE_URL || 'http://task-service:3001',
  node: process.env.NODE_SERVICE_URL || 'http://node-service:3002',
  scheduler: process.env.SCHEDULER_SERVICE_URL || 'http://scheduler-service:3003',
  websocket: process.env.WEBSOCKET_GATEWAY_URL || 'http://websocket-gateway:3004',
};

const STREAMS = [
  { name: 'tasks.events', groups: ['schedulers'] },
  { name: 'scheduler.decisions', groups: ['agents'] },
];

/**
 * Aggregates metrics and updates business gauges
 */
async function aggregateBusinessMetrics() {
  // 1. Consumer Lag from Redis
  for (const stream of STREAMS) {
    for (const group of stream.groups) {
      try {
        const info = await redis.xinfo('GROUPS', stream.name) as any[][];
        for (const groupInfo of info) {
          const g: Record<string, any> = {};
          for (let i = 0; i < groupInfo.length; i += 2) {
            g[groupInfo[i]] = groupInfo[i + 1];
          }
          if (g.name === group) {
            eventConsumerLagGauge.set({ stream: stream.name, group }, g.lag !== undefined ? g.lag : g.pending);
          }
        }
      } catch (err) {
        logger.debug(`Could not pull lag for ${stream.name}:${group}: ${(err as Error).message}`);
      }
    }
  }

  // 2. Active Nodes from node-service (Querying API)
  try {
    const res = await fetch(`${SERVICES.node}/nodes?status=ONLINE`);
    if (res.ok) {
      const nodes = await res.json() as any[];
      activeNodesGauge.set(nodes.length);
    }
  } catch (err) {
    logger.debug(`Could not pull active nodes: ${(err as Error).message}`);
  }

  // 3. Pending Tasks from task-service (Querying Stats API)
  try {
    const res = await fetch(`${SERVICES.task}/tasks/stats`);
    if (res.ok) {
      const stats = await res.json() as any;
      pendingTasksGauge.set(stats.pending || 0);
    }
  } catch (err) {
    logger.debug(`Could not pull task stats: ${(err as Error).message}`);
  }

  // 4. Scrape and Extract from /metrics
  for (const [name, url] of Object.entries(SERVICES)) {
    try {
      const res = await fetch(`${url}/metrics`);
      if (!res.ok) continue;
      
      const text = await res.text();
      
      if (name === 'scheduler') {
        const match = text.match(/scheduling_duration_ms_sum\s+([\d.]+)/);
        if (match) schedulingDecisionHistogram.observe(parseFloat(match[1]));
      }
      
      if (name === 'api') {
        const match = text.match(/system_load_score\s+([\d.]+)/);
        if (match) systemLoadGauge.set(parseFloat(match[1]));
      }
    } catch (err) {
      logger.debug(`Failed to parse metrics for ${name}: ${(err as Error).message}`);
    }
  }
}

// Routes
app.get('/metrics', async (request, reply) => {
  await aggregateBusinessMetrics();
  
  // Start with our own metrics
  let aggregatedOutput = await registry.metrics();
  
  // Append raw metrics from all services
  for (const [name, url] of Object.entries(SERVICES)) {
    try {
      const res = await fetch(`${url}/metrics`);
      if (res.ok) {
        const text = await res.text();
        aggregatedOutput += `\n\n# --- Aggregated from ${name} ---\n${text}`;
      }
    } catch (err) {
      logger.error(`Aggregation failed for ${name}: ${(err as Error).message}`);
    }
  }
  
  reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  return aggregatedOutput;
});

// Health Endpoints
app.get('/health', async () => HealthCheck.getLiveness());
app.get('/health/live', async () => HealthCheck.getLiveness());
app.get('/health/ready', async () => HealthCheck.getReadiness({
  redis: async () => {
    try { return (await redis.ping()) === 'PONG'; } catch { return false; }
  }
}));
app.get('/health/startup', async () => HealthCheck.getStartup());

const start = async () => {
  try {
    await redis.connect();
    
    // Register unified logging
    await app.register(fastifyLoggingPlugin, { logger, serviceName: 'metrics-service' });

    const port = parseInt(process.env.PORT || '3005');
    await app.listen({ port, host: '0.0.0.0' });

    // Initialize shutdown manager
    GracefulShutdown.init();
    GracefulShutdown.registerHandler('redis', async () => {
      if (redis) redis.disconnect();
    });
    GracefulShutdown.registerHandler('app', async () => {
      await app.close();
    });

    HealthCheck.setReady(true);
    
    logger.info(`Metrics Service (Aggregator) listening on port ${port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
