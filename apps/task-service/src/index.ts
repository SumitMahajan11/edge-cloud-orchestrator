import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Pool } from 'pg';
import { EventBus, DEFAULT_TOPIC_CONFIG } from '@edgecloud/event-bus';
import {
  createAuthMiddleware,
  requireRole,
  requirePermission,
  CreateTaskSchema,
  TaskIdParamsSchema,
  TaskListQuerySchema,
  CancelTaskBodySchema,
  ScheduleTaskBodySchema,
  CompleteTaskBodySchema,
  FailTaskBodySchema,
  VERSION,
} from '@edgecloud/shared-kernel';
import { CircuitBreaker, CircuitBreakerRegistry } from '@edgecloud/circuit-breaker';
import { PostgresTaskRepository } from './repository';
import { TaskService } from './service';
import { registerMetrics, metricsEndpoint } from './metrics';

const app = Fastify({
  logger: true,
  trustProxy: true,
});

// Configuration
const config = {
  jwtSecret: process.env.JWT_SECRET || 'jwt-secret',
  serviceToken: process.env.SERVICE_TOKEN || 'dev-service-token',
  database: {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '26257'),
    database: process.env.DATABASE_NAME || 'edgecloud',
    user: process.env.DATABASE_USER || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  },
  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  },
};

// Database connection
const pool = new Pool(config.database);

// Event bus
const eventBus = new EventBus({
  clientId: 'task-service',
  brokers: config.kafka.brokers,
});

// Repository and service
const repository = new PostgresTaskRepository(pool);
const taskService = new TaskService(repository, eventBus);

// Circuit breaker registry
const circuitBreakerRegistry = new CircuitBreakerRegistry();

// Circuit breakers for external dependencies
const dbCircuitBreaker = circuitBreakerRegistry.getOrCreate('database', {
  failureThreshold: 5,
  resetTimeout: 30000,
  halfOpenMaxCalls: 3,
});

const kafkaCircuitBreaker = circuitBreakerRegistry.getOrCreate('kafka', {
  failureThreshold: 3,
  resetTimeout: 15000,
  halfOpenMaxCalls: 2,
});

// Register plugins
async function registerPlugins() {
  // CORS
  await app.register(cors, {
    origin: process.env.CORS_ORIGINS?.split(',') || true,
    credentials: true,
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    cache: 10000,
    allowList: ['127.0.0.1'],
    redis: process.env.REDIS_URL ? { url: process.env.REDIS_URL } : undefined,
  });

  // Authentication middleware
  const authMiddleware = createAuthMiddleware({
    jwtSecret: config.jwtSecret,
    serviceToken: config.serviceToken,
    skipPaths: ['/health', '/metrics', '/ready'],
  });

  app.addHook('preHandler', authMiddleware);
}

// Health check (no auth)
app.get('/health', async () => {
  const circuitBreakerMetrics = circuitBreakerRegistry.getAllMetrics();
  const allHealthy = Object.values(circuitBreakerMetrics).every((m: any) => m.state !== 'OPEN');
  
  return {
    status: allHealthy ? 'healthy' : 'degraded',
    service: 'task-service',
    timestamp: new Date().toISOString(),
    version: VERSION,
    circuitBreakers: circuitBreakerMetrics,
  };
});

// Readiness check
app.get('/ready', async () => {
  try {
    await pool.query('SELECT 1');
    return { status: 'ready', timestamp: new Date().toISOString() };
  } catch (error) {
    return { status: 'not ready', error: (error as Error).message };
  }
});

// Metrics endpoint (no auth)
app.get('/metrics', metricsEndpoint);

// Circuit breaker status endpoint
app.get('/internal/circuit-breakers', async () => {
  return circuitBreakerRegistry.getAllMetrics();
});

// API Routes with validation and auth
app.post('/tasks', {
  preHandler: requirePermission('tasks:create'),
}, async (request: FastifyRequest, reply: FastifyReply) => {
  const input = CreateTaskSchema.parse(request.body);
  const task = await taskService.createTask(input);
  reply.status(201).send(task);
});

app.get('/tasks', {
  preHandler: requirePermission('tasks:read'),
}, async (request: FastifyRequest, reply: FastifyReply) => {
  const query = TaskListQuerySchema.parse(request.query);
  const tasks = await taskService.listTasks(query);
  reply.send(tasks);
});

app.get('/tasks/stats', {
  preHandler: requirePermission('tasks:read'),
}, async () => {
  return taskService.getTaskStats();
});

app.get('/tasks/:id', {
  preHandler: requirePermission('tasks:read'),
}, async (request: FastifyRequest, reply: FastifyReply) => {
  const { id } = TaskIdParamsSchema.parse(request.params);
  const task = await taskService.getTask(id);
  
  if (!task) {
    reply.status(404).send({ error: 'Task not found', code: 'NOT_FOUND' });
    return;
  }
  
  reply.send(task);
});

app.post('/tasks/:id/cancel', {
  preHandler: requirePermission('tasks:update'),
}, async (request: FastifyRequest, reply: FastifyReply) => {
  const { id } = TaskIdParamsSchema.parse(request.params);
  const { reason } = CancelTaskBodySchema.parse(request.body);
  
  const task = await taskService.cancelTask(id, reason);
  
  if (!task) {
    reply.status(404).send({ error: 'Task not found', code: 'NOT_FOUND' });
    return;
  }
  
  reply.send(task);
});

// Internal API for scheduler (service-to-service auth required)
app.post('/internal/tasks/:id/schedule', async (request: FastifyRequest, reply: FastifyReply) => {
  // Verify service-to-service auth
  if (!request.serviceAuth) {
    reply.status(401).send({ error: 'Service authentication required', code: 'AUTH_REQUIRED' });
    return;
  }

  const { id } = TaskIdParamsSchema.parse(request.params);
  const { nodeId, score } = ScheduleTaskBodySchema.parse(request.body);
  
  const task = await taskService.scheduleTask(id, nodeId, score);
  
  if (!task) {
    reply.status(404).send({ error: 'Task not found', code: 'NOT_FOUND' });
    return;
  }
  
  reply.send(task);
});

app.post('/internal/tasks/:id/complete', async (request: FastifyRequest, reply: FastifyReply) => {
  if (!request.serviceAuth) {
    reply.status(401).send({ error: 'Service authentication required', code: 'AUTH_REQUIRED' });
    return;
  }

  const { id } = TaskIdParamsSchema.parse(request.params);
  const { executionTimeMs, cost, output } = CompleteTaskBodySchema.parse(request.body);
  
  const task = await taskService.completeTask(id, executionTimeMs, cost, output);
  
  if (!task) {
    reply.status(404).send({ error: 'Task not found', code: 'NOT_FOUND' });
    return;
  }
  
  reply.send(task);
});

app.post('/internal/tasks/:id/fail', async (request: FastifyRequest, reply: FastifyReply) => {
  if (!request.serviceAuth) {
    reply.status(401).send({ error: 'Service authentication required', code: 'AUTH_REQUIRED' });
    return;
  }

  const { id } = TaskIdParamsSchema.parse(request.params);
  const { error, retryCount, willRetry } = FailTaskBodySchema.parse(request.body);
  
  const task = await taskService.failTask(id, error, retryCount, willRetry);
  
  if (!task) {
    reply.status(404).send({ error: 'Task not found', code: 'NOT_FOUND' });
    return;
  }
  
  reply.send(task);
});

// Start server
async function start() {
  try {
    await registerPlugins();
    
    // Connect to event bus and create topics (optional)
    try {
      await eventBus.connect();
      await eventBus.createTopics(DEFAULT_TOPIC_CONFIG);
      console.log('Event bus connected');
    } catch (kafkaErr) {
      console.warn('Event bus connection failed, continuing without Kafka:', (kafkaErr as Error).message);
    }
    
    // Register metrics
    registerMetrics();
    
    const port = parseInt(process.env.PORT || '3001', 10);
    await app.listen({ port, host: '0.0.0.0' });
    
    console.log(`Task Service running on port ${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await eventBus.disconnect();
  await pool.end();
  await app.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await eventBus.disconnect();
  await pool.end();
  await app.close();
  process.exit(0);
});

start();
