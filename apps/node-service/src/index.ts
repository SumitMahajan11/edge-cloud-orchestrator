import { env } from './config/env';
import { 
  initTelemetry, 
  createLogger, 
  fastifyLoggingPlugin,
  SecretManagerFactory,
  RedisFactory,
  GracefulShutdown,
  HealthCheck
} from '@edgecloud/shared-kernel';
initTelemetry('node-service');

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Pool } from 'pg';
import { EventBus, TOPICS } from '@edgecloud/event-bus';
import { EdgeNode, RegisterNodeCommand, NodeStatus, type NodeRegisteredEvent, type NodeHeartbeatEvent } from '@edgecloud/shared-kernel';
import { CircuitBreakerRegistry } from '@edgecloud/circuit-breaker';
import type { FastifyRequest, FastifyReply } from 'fastify';

const logger = createLogger('node-service');
const app = Fastify({ logger: false, trustProxy: true });

// Standardized Logging & Tracing
void app.register(fastifyLoggingPlugin, { logger, serviceName: 'node-service' });

let pool: Pool;
let eventBus: EventBus;
let jwtSecret: string;
let serviceToken: string;
let redisClient: any;

// Circuit breaker registry
const circuitBreakerRegistry = new CircuitBreakerRegistry();

// Rate limiting
void app.register(async (instance) => {
  if (redisClient) {
    void instance.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
      allowList: ['127.0.0.1'],
      redis: redisClient,
    });
  } else {
    void instance.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
      allowList: ['127.0.0.1'],
    });
  }
});

// Health check with circuit breaker status
app.get('/health', async () => {
  const circuitBreakerMetrics = circuitBreakerRegistry.getAllMetrics();
  const allHealthy = Object.values(circuitBreakerMetrics).every((m: any) => m.state !== 'OPEN');
  
  return {
    status: allHealthy ? 'healthy' : 'degraded',
    service: 'node-service',
    timestamp: new Date().toISOString(),
    circuitBreakers: circuitBreakerMetrics,
  };
});

// Register node
app.post('/nodes', async (request: FastifyRequest, reply: FastifyReply) => {
  const cmd = request.body as RegisterNodeCommand;
  
  const result = await pool.query(
    `INSERT INTO nodes (name, location, region, ip_address, port, url, cpu_cores, memory_gb, storage_gb,
      cost_per_hour, max_tasks, bandwidth_in_mbps, bandwidth_out_mbps, capabilities, labels, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'OFFLINE')
     RETURNING *`,
    [
      cmd.name, cmd.location, cmd.region, cmd.ipAddress, cmd.port,
      `http://${cmd.ipAddress}:${cmd.port}`,
      cmd.cpuCores, cmd.memoryGB, cmd.storageGB,
      cmd.costPerHour || 0.05, cmd.maxTasks || 10,
      cmd.bandwidthInMbps || 100, cmd.bandwidthOutMbps || 100,
      cmd.capabilities || [], JSON.stringify(cmd.labels || {})
    ]
  );
  
  const node = mapRowToNode(result.rows[0]);
  
  // Publish event (non-blocking - don't fail if Redis is not available)
  try {
    await eventBus.publish<NodeRegisteredEvent>(TOPICS.NODE_EVENTS, {
      eventType: 'NodeRegistered',
      aggregateId: node.id,
      version: 1,
      nodeId: node.id,
      name: node.name,
      region: node.region,
      capabilities: node.capabilities || [],
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Failed to publish node registered event:');
  }
  
  void reply.status(201).send(node);
});

// List nodes
app.get('/nodes', async (request: FastifyRequest) => {
  const { status, region } = request.query as any;
  let query = 'SELECT * FROM nodes';
  const values: any[] = [];
  const conditions: string[] = [];
  
  if (status) {
    conditions.push(`status = $${values.length + 1}`);
    values.push(status);
  }
  if (region) {
    conditions.push(`region = $${values.length + 1}`);
    values.push(region);
  }
  
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  
  query += ' ORDER BY created_at DESC';
  
  const result = await pool.query(query, values);
  return result.rows.map(mapRowToNode);
});

// Get node
app.get('/nodes/:id', async (request: FastifyRequest, reply: FastifyReply) => {
  const { id } = request.params as any;
  const result = await pool.query('SELECT * FROM nodes WHERE id = $1', [id]);
  
  if (result.rows.length === 0) {
    void reply.status(404).send({ error: 'Node not found' });
    return;
  }
  
  return mapRowToNode(result.rows[0]);
});

// Heartbeat
app.post('/nodes/:id/heartbeat', async (request: FastifyRequest, reply: FastifyReply) => {
  const { id } = request.params as any;
  const metrics = request.body as any;
  
  const result = await pool.query(
    `UPDATE nodes SET 
      cpu_usage = $1, memory_usage = $2, storage_usage = $3,
      latency = $4, tasks_running = $5, last_heartbeat = NOW(),
      status = 'ONLINE', updated_at = NOW()
     WHERE id = $6 RETURNING *`,
    [metrics.cpuUsage, metrics.memoryUsage, metrics.storageUsage,
     metrics.latency, metrics.tasksRunning, id]
  );
  
  if (result.rows.length === 0) {
    void reply.status(404).send({ error: 'Node not found' });
    return;
  }
  
  const node = mapRowToNode(result.rows[0]);
  
  // Publish heartbeat event (non-blocking)
  try {
    await eventBus.publish<NodeHeartbeatEvent>(TOPICS.NODE_EVENTS, {
      eventType: 'NodeHeartbeat',
      aggregateId: node.id,
      version: 1,
      nodeId: node.id,
      metrics: {
        cpuUsage: node.cpuUsage,
        memoryUsage: node.memoryUsage,
        tasksRunning: node.tasksRunning,
      },
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Failed to publish heartbeat event:');
  }
  
  return node;
});

// Get healthy nodes (for scheduler)
app.get('/internal/nodes/healthy', async () => {
  const result = await pool.query(
    `SELECT * FROM nodes 
     WHERE status = 'ONLINE' 
     AND is_maintenance_mode = false
     AND tasks_running < max_tasks
     AND last_heartbeat > NOW() - INTERVAL '30 seconds'
     ORDER BY cpu_usage ASC`
  );
  return result.rows.map(mapRowToNode);
});

function mapRowToNode(row: any): EdgeNode {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    region: row.region,
    status: row.status,
    ipAddress: row.ip_address,
    port: row.port,
    url: row.url,
    cpuCores: row.cpu_cores,
    memoryGB: row.memory_gb,
    storageGB: row.storage_gb,
    cpuUsage: row.cpu_usage,
    memoryUsage: row.memory_usage,
    storageUsage: row.storage_usage,
    latency: row.latency,
    tasksRunning: row.tasks_running,
    maxTasks: row.max_tasks,
    costPerHour: row.cost_per_hour,
    bandwidthInMbps: row.bandwidth_in_mbps,
    bandwidthOutMbps: row.bandwidth_out_mbps,
    isMaintenanceMode: row.is_maintenance_mode,
    healthScore: row.health_score ?? 1.0,
    consecutiveFailures: row.consecutive_failures ?? 0,
    capabilities: row.capabilities,
    labels: row.labels,
    lastHeartbeat: row.last_heartbeat,
    carbonIntensity: row.carbon_intensity || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function start() {
  // Config is already validated via env.ts
  jwtSecret = env.JWT_SECRET;
  serviceToken = env.SERVICE_TOKEN;

  pool = new Pool(
    env.DATABASE_URL 
      ? { connectionString: env.DATABASE_URL }
      : {
          host: env.DATABASE_HOST,
          port: env.DATABASE_PORT,
          database: env.DATABASE_NAME,
          user: env.DATABASE_USER,
          password: env.DATABASE_PASSWORD,
        }
  );

  if (env.REDIS_URL || env.REDIS_SENTINELS) {
    const secretManager = SecretManagerFactory.create();
    redisClient = await RedisFactory.createClient(secretManager);
  }

  const kafkaBrokers = env.KAFKA_BROKERS.split(',');
  
  eventBus = new EventBus({
    clientId: 'node-service',
    brokers: kafkaBrokers,
    redis: redisClient,
  });

  const corsOrigins = env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',');
  await app.register(cors, { origin: corsOrigins, credentials: true });

  try {
    await eventBus.connect();
    logger.info('Event bus connected');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Event bus connection failed, continuing without Redis Streams:');
  }

  const port = env.PORT;
  await app.listen({ port, host: '0.0.0.0' });

  GracefulShutdown.init();
  GracefulShutdown.registerHandler('eventbus', () => eventBus.disconnect());
  GracefulShutdown.registerHandler('db', () => pool.end());
  GracefulShutdown.registerHandler('app', () => app.close());

  HealthCheck.setReady(true);
  logger.info(`Node Service running on port ${port}`);
}

// Graceful shutdown
let isShuttingDown = false;

// Start the application
void start();
