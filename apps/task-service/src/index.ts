import { 
  initTelemetry,
  createLogger,
  fastifyLoggingPlugin,
  GracefulShutdown,
  HealthCheck
} from '@edgecloud/shared-kernel';
initTelemetry('task-service');

const logger = createLogger('task-service');

import { CircuitBreaker, CircuitBreakerRegistry } from '@edgecloud/circuit-breaker';
import { DEFAULT_TOPIC_CONFIG,EventBus } from '@edgecloud/event-bus';
import {
  CancelTaskBodySchema,
  CompleteTaskBodySchema,
  createAuthMiddleware,
  CreateTaskSchema,
  FailTaskBodySchema,
  requirePermission,
  requireRole,
  ScheduleTaskBodySchema,
  TaskIdParamsSchema,
  TaskListQuerySchema,
  VERSION,
  SecretManagerFactory,
  validateRequiredSecrets,
} from '@edgecloud/shared-kernel';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyReply,type FastifyRequest } from 'fastify';
import { Pool } from 'pg';

import { metricsEndpoint,registerMetrics } from './metrics';
import { PostgresTaskRepository } from './repository';
import { TaskService } from './service';

const app = Fastify({
  logger: false,
  trustProxy: true,
});

// Global dependencies (initialized in start)
let pool: Pool;
let eventBus: EventBus;
let repository: PostgresTaskRepository;
let taskService: TaskService;
let jwtSecret: string;
let serviceToken: string;

// Circuit breaker registry
const circuitBreakerRegistry = new CircuitBreakerRegistry();

// Circuit breakers for external dependencies
const dbCircuitBreaker = circuitBreakerRegistry.getOrCreate('database', {
  failureThreshold: 5,
  resetTimeout: 30000,
  halfOpenMaxCalls: 3,
});

const redisStreamCircuitBreaker = circuitBreakerRegistry.getOrCreate('redis-streams', {
  failureThreshold: 3,
  resetTimeout: 15000,
  halfOpenMaxCalls: 2,
});

// Register plugins
async function registerPlugins() {
  const secretManager = SecretManagerFactory.create();
  const corsOriginsRaw = await secretManager.getSecret('CORS_ORIGINS');
  const corsOrigins = corsOriginsRaw ? corsOriginsRaw.split(',') : true;

  // CORS
  await app.register(cors, {
    origin: corsOrigins,
    credentials: true,
  });

  // Rate limiting
  const redisUrl = await secretManager.getSecret('REDIS_URL');
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    cache: 10000,
    allowList: ['127.0.0.1'],
    redis: redisUrl ? { url: redisUrl } : undefined,
  });

  // Authentication middleware
  const authMiddleware = createAuthMiddleware({
    jwtSecret: jwtSecret,
    serviceToken: serviceToken,
    skipPaths: ['/health', '/metrics', '/ready'],
  });

  // Global request ID middleware and standardized logging
  await app.register(fastifyLoggingPlugin, { logger, serviceName: 'task-service' });

  app.addHook('preHandler', authMiddleware);
}

// Health checks
app.get('/health', async () => HealthCheck.getLiveness());
app.get('/health/live', async () => HealthCheck.getLiveness());
app.get('/health/ready', async () => HealthCheck.getReadiness({
  db: async () => {
    try { await pool.query('SELECT 1'); return true; } catch { return false; }
  }
}));
app.get('/health/startup', async () => HealthCheck.getStartup());

// Legacy probe aliases (for backward compatibility if needed)
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
  const secretManager = SecretManagerFactory.create();

  // Validate critical secrets
  await validateRequiredSecrets(
    secretManager,
    ['DATABASE_HOST', 'DATABASE_PASSWORD', 'JWT_SECRET', 'REDIS_URL'],
    'task-service'
  );

  // Load config
  jwtSecret = await secretManager.getSecret('JWT_SECRET') || ''; // Already validated
  serviceToken = await secretManager.getSecret('SERVICE_TOKEN') || 'dev-service-token';

  const dbHost = await secretManager.getSecret('DATABASE_HOST');
  const dbPort = parseInt(await secretManager.getSecret('DATABASE_PORT') || '26257');
  const dbName = await secretManager.getSecret('DATABASE_NAME') || 'edgecloud';
  const dbUser = await secretManager.getSecret('DATABASE_USER') || 'root';
  const dbPass = await secretManager.getSecret('DATABASE_PASSWORD') || '';
  const dbSsl = await secretManager.getSecret('DATABASE_SSL') === 'true';

  pool = new Pool({
    host: dbHost,
    port: dbPort,
    database: dbName,
    user: dbUser,
    password: dbPass,
    ssl: dbSsl ? { rejectUnauthorized: false } : false,
  });

  const redisUrl = await secretManager.getSecret('REDIS_URL') || 'redis://localhost:6379';

  eventBus = new EventBus({
    clientId: 'task-service',
    brokers: [redisUrl],
  });

  repository = new PostgresTaskRepository(pool);
  taskService = new TaskService(repository, eventBus);

  try {
    await registerPlugins();
    
    // Connect to event bus and create topics (optional)
    try {
      await eventBus.connect();
      await eventBus.createTopics(DEFAULT_TOPIC_CONFIG);
      logger.info(`Event bus connected to Redis Streams at ${redisUrl}`);
    } catch (redisErr) {
      logger.warn(`Event bus connection failed, continuing without Redis Streams: ${(redisErr as Error).message}`);
    }
    
    // Register metrics
    registerMetrics();
    
    const port = parseInt(await secretManager.getSecret('PORT') || '3001', 10);
    await app.listen({ port, host: '0.0.0.0' });
    
    // Initialize shutdown manager
    GracefulShutdown.init();
    GracefulShutdown.registerHandler('bus', async () => {
      if (eventBus) await eventBus.disconnect();
    });
    GracefulShutdown.registerHandler('db', async () => {
      if (pool) await pool.end();
    });
    GracefulShutdown.registerHandler('app', async () => {
      await app.close();
    });

    HealthCheck.setReady(true);

    logger.info(`Task Service running on port ${port}`);
  } catch (err) {
    logger.error(err, 'Task Service fatal error on start');
    process.exit(1);
  }
}

// Start the application
start();
