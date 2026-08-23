import { env } from "./config/env";
import {
  initTelemetry,
  createLogger,
  fastifyLoggingPlugin,
  GracefulShutdown,
  HealthCheck,
  RedisFactory,
} from "@edgecloud/shared-kernel";
initTelemetry("task-service");

const logger = createLogger("task-service");

import { CircuitBreakerRegistry } from "@edgecloud/circuit-breaker";
import { DEFAULT_TOPIC_CONFIG, EventBus } from "@edgecloud/event-bus";
import {
  CancelTaskBodySchema,
  CompleteTaskBodySchema,
  createAuthMiddleware,
  CreateTaskSchema,
  FailTaskBodySchema,
  requirePermission,
  ScheduleTaskBodySchema,
  TaskIdParamsSchema,
  TaskListQuerySchema,
  SecretManagerFactory,
} from "@edgecloud/shared-kernel";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { Pool } from "pg";

import { metricsEndpoint, registerMetrics } from "./metrics";
import { PostgresTaskRepository } from "./repository";
import { TaskService } from "./service";

const app = Fastify({
  logger: false,
  trustProxy: true,
});

// Global dependencies (initialized in start)
let pool: Pool;
let eventBus: EventBus;
let repository: PostgresTaskRepository;
let taskService: TaskService;
let redisClient: any;
let redisUrl: string;

// Circuit breaker registry
const circuitBreakerRegistry = new CircuitBreakerRegistry();

// Register plugins
async function registerPlugins() {
  const corsOrigins =
    env.CORS_ORIGINS === "*" ? true : env.CORS_ORIGINS.split(",");

  // CORS
  await app.register(cors, {
    origin: corsOrigins,
    credentials: true,
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    cache: 10000,
    allowList: ["127.0.0.1"],
    redis: redisClient,
  });

  // Authentication middleware
  const authMiddleware = createAuthMiddleware({
    jwtSecret: env.JWT_SECRET,
    serviceToken: env.SERVICE_TOKEN,
    skipPaths: ["/health", "/metrics", "/ready"],
  });

  // Global request ID middleware and standardized logging
  await app.register(fastifyLoggingPlugin, {
    logger,
    serviceName: "task-service",
  });

  app.addHook("preHandler", authMiddleware);
}

// Health checks
app.get("/health", async () => HealthCheck.getLiveness());
app.get("/health/live", async () => HealthCheck.getLiveness());
app.get("/health/ready", async () =>
  HealthCheck.getReadiness({
    db: async () => {
      try {
        await pool.query("SELECT 1");
        return true;
      } catch {
        return false;
      }
    },
  }),
);
app.get("/health/startup", async () => HealthCheck.getStartup());

// Legacy probe aliases (for backward compatibility if needed)
app.get("/ready", async () => {
  try {
    await pool.query("SELECT 1");
    return { status: "ready", timestamp: new Date().toISOString() };
  } catch (error) {
    return { status: "not ready", error: (error as Error).message };
  }
});

// Metrics endpoint (no auth)
app.get("/metrics", metricsEndpoint);

// Circuit breaker status endpoint
app.get("/internal/circuit-breakers", async () => {
  return circuitBreakerRegistry.getAllMetrics();
});

// API Routes with validation and auth
app.post(
  "/tasks",
  {
    preHandler: requirePermission("tasks:create"),
  },
  async (request: FastifyRequest, reply: FastifyReply) => {
    const input = CreateTaskSchema.parse(request.body);
    const task = await taskService.createTask(input);
    void reply.status(201).send(task);
  },
);

app.get(
  "/tasks",
  {
    preHandler: requirePermission("tasks:read"),
  },
  async (request: FastifyRequest, reply: FastifyReply) => {
    const query = TaskListQuerySchema.parse(request.query);
    const tasks = await taskService.listTasks(query);
    void reply.send(tasks);
  },
);

app.get(
  "/tasks/stats",
  {
    preHandler: requirePermission("tasks:read"),
  },
  async () => {
    return taskService.getTaskStats();
  },
);

app.get(
  "/tasks/:id",
  {
    preHandler: requirePermission("tasks:read"),
  },
  async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = TaskIdParamsSchema.parse(request.params);
    const task = await taskService.getTask(id);

    if (!task) {
      void reply
        .status(404)
        .send({ error: "Task not found", code: "NOT_FOUND" });
      return;
    }

    void reply.send(task);
  },
);

app.post(
  "/tasks/:id/cancel",
  {
    preHandler: requirePermission("tasks:update"),
  },
  async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = TaskIdParamsSchema.parse(request.params);
    const { reason } = CancelTaskBodySchema.parse(request.body);

    const task = await taskService.cancelTask(id, reason);

    if (!task) {
      void reply
        .status(404)
        .send({ error: "Task not found", code: "NOT_FOUND" });
      return;
    }

    void reply.send(task);
  },
);

// Internal API for scheduler (service-to-service auth required)
app.post(
  "/internal/tasks/:id/schedule",
  async (request: FastifyRequest, reply: FastifyReply) => {
    // Verify service-to-service auth
    if (!request.serviceAuth) {
      void reply.status(401).send({
        error: "Service authentication required",
        code: "AUTH_REQUIRED",
      });
      return;
    }

    const { id } = TaskIdParamsSchema.parse(request.params);
    const { nodeId, score } = ScheduleTaskBodySchema.parse(request.body);

    const task = await taskService.scheduleTask(id, nodeId, score);

    if (!task) {
      void reply
        .status(404)
        .send({ error: "Task not found", code: "NOT_FOUND" });
      return;
    }

    void reply.send(task);
  },
);

app.post(
  "/internal/tasks/:id/complete",
  async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.serviceAuth) {
      void reply.status(401).send({
        error: "Service authentication required",
        code: "AUTH_REQUIRED",
      });
      return;
    }

    const { id } = TaskIdParamsSchema.parse(request.params);
    const { executionTimeMs, cost, output } = CompleteTaskBodySchema.parse(
      request.body,
    );

    const task = await taskService.completeTask(
      id,
      executionTimeMs,
      cost,
      output,
    );

    if (!task) {
      void reply
        .status(404)
        .send({ error: "Task not found", code: "NOT_FOUND" });
      return;
    }

    void reply.send(task);
  },
);

app.post(
  "/internal/tasks/:id/fail",
  async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.serviceAuth) {
      void reply.status(401).send({
        error: "Service authentication required",
        code: "AUTH_REQUIRED",
      });
      return;
    }

    const { id } = TaskIdParamsSchema.parse(request.params);
    const { error, retryCount, willRetry } = FailTaskBodySchema.parse(
      request.body,
    );

    const task = await taskService.failTask(id, error, retryCount, willRetry);

    if (!task) {
      void reply
        .status(404)
        .send({ error: "Task not found", code: "NOT_FOUND" });
      return;
    }

    void reply.send(task);
  },
);

// Start server
async function start() {
  pool = new Pool({
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    database: env.DATABASE_NAME,
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
  });

  redisUrl = env.REDIS_URL;

  if (env.REDIS_URL || env.REDIS_SENTINELS) {
    // Note: RedisFactory still needs SecretManager if it's designed that way,
    // but we can pass a mock or the env-based one if needed.
    // For now, let's keep it simple or pass the factory what it needs.
    const secretManager = SecretManagerFactory.create();
    redisClient = await RedisFactory.createClient(secretManager);
  }

  const kafkaBrokers = env.KAFKA_BROKERS.split(",");

  eventBus = new EventBus({
    clientId: "task-service",
    brokers: kafkaBrokers,
    redis: redisClient,
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
      logger.warn(
        `Event bus connection failed, continuing without Redis Streams: ${(redisErr as Error).message}`,
      );
    }

    // Register metrics
    registerMetrics();

    const port = env.PORT;
    await app.listen({ port, host: "0.0.0.0" });

    // Initialize shutdown manager
    GracefulShutdown.init();
    GracefulShutdown.registerHandler("bus", async () => {
      if (eventBus) await eventBus.disconnect();
    });
    GracefulShutdown.registerHandler("db", async () => {
      if (pool) await pool.end();
    });
    GracefulShutdown.registerHandler("app", async () => {
      await app.close();
    });

    HealthCheck.setReady(true);

    logger.info(`Task Service running on port ${port}`);
  } catch (err) {
    logger.error(err, "Task Service fatal error on start");
    process.exit(1);
  }
}

// Start the application if not being imported for tests
if (env.NODE_ENV !== "test" && !env.VITEST) {
  start().catch((err) => {
    logger.error(err, "Task Service fatal error on start");
    process.exit(1);
  });
}

export { app, pool, eventBus, taskService, start };
