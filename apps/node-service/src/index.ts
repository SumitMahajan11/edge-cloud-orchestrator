import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Pool } from 'pg';
import { EventBus, TOPICS } from '@edgecloud/event-bus';
import { EdgeNode, RegisterNodeCommand, NodeStatus, type NodeRegisteredEvent, type NodeHeartbeatEvent } from '@edgecloud/shared-kernel';
import { CircuitBreakerRegistry } from '@edgecloud/circuit-breaker';
import type { FastifyRequest, FastifyReply } from 'fastify';

const app = Fastify({ logger: true, trustProxy: true });

const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '26257'),
  database: process.env.DATABASE_NAME || 'edgecloud',
  user: process.env.DATABASE_USER || 'root',
  password: process.env.DATABASE_PASSWORD || '',
});

const eventBus = new EventBus({
  clientId: 'node-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
});

// Circuit breaker registry
const circuitBreakerRegistry = new CircuitBreakerRegistry();

// Configuration
const config = {
  jwtSecret: process.env.JWT_SECRET || 'jwt-secret',
  serviceToken: process.env.SERVICE_TOKEN || 'dev-service-token',
};

app.register(cors, { origin: true, credentials: true });

// Rate limiting
app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  allowList: ['127.0.0.1'],
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
  
  // Publish event (non-blocking - don't fail if Kafka is not available)
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
    console.warn('Failed to publish node registered event:', (err as Error).message);
  }
  
  reply.status(201).send(node);
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
    reply.status(404).send({ error: 'Node not found' });
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
    reply.status(404).send({ error: 'Node not found' });
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
    console.warn('Failed to publish heartbeat event:', (err as Error).message);
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
    capabilities: row.capabilities,
    labels: row.labels,
    lastHeartbeat: row.last_heartbeat,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function start() {
  try {
    await eventBus.connect();
    console.log('Event bus connected');
  } catch (err) {
    console.warn('Event bus connection failed, continuing without Kafka:', (err as Error).message);
  }
  const port = parseInt(process.env.PORT || '3002');
  await app.listen({ port, host: '0.0.0.0' });
  console.log('Node Service running on port', port);
}

// Graceful shutdown
let isShuttingDown = false;

process.on('SIGTERM', async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log('Shutting down gracefully...');
  
  // Stop accepting new connections
  await app.close();
  
  // Disconnect from event bus
  await eventBus.disconnect();
  
  // Close database connections
  await pool.end();
  
  console.log('Shutdown complete');
  process.exit(0);
});

process.on('SIGINT', async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  await app.close();
  await eventBus.disconnect();
  await pool.end();
  process.exit(0);
});

start();
