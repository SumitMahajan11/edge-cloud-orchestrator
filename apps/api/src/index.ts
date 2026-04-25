import { 
  initTelemetry, 
  createLogger, 
  fastifyLoggingPlugin,
  SecretManagerFactory, 
  SecretManager,
  GracefulShutdown,
  HealthCheck
} from '@edgecloud/shared-kernel';
initTelemetry('orchestrator-api');

const logger = createLogger('orchestrator-api');

// Prevent background timer errors from crashing the process in development
if (process.env.NODE_ENV !== 'production') {
  process.on('uncaughtException', (err: any) => {
    // Let fatal startup errors (port in use, etc.) kill the process normally
    if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
      logger.error({ err: err.message }, 'Fatal startup error - exiting');
      process.exit(1);
    }
    logger.error({ err: err.message }, 'Uncaught exception (dev mode - keeping server up)');
  });
  process.on('unhandledRejection', (reason: any) => {
    logger.error({ reason }, 'Unhandled rejection (dev mode - keeping server up)');
  });
}

import 'dotenv/config';

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import websocket from '@fastify/websocket';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import Redis from 'ioredis';
import path from 'path';

import {
  initializeServices,
  shutdownServices,
} from './initializers/services.js';
import { authPlugin } from './plugins/auth';
import { errorHandler } from './plugins/error-handler';
// Plugins
import { prismaPlugin } from './plugins/prisma';
import { redisPlugin } from './plugins/redis';
import { requestLogger } from './plugins/request-logger';
import { swaggerPlugin } from './plugins/swagger';
import { v1Routes } from './routes/v1-manifest';
import versionNegotiationPlugin from './plugins/version-negotiation';
import { BackpressureController } from './services/backpressure-controller';
import { ColdStartHandler } from './services/cold-start-handler';
import { GracefulDegradationService } from './services/graceful-degradation';
import { HeartbeatMonitor } from './services/heartbeat-monitor';
import { IdempotencyService } from './services/idempotency-service';
import { PriorityScheduler } from './services/priority-scheduler';
import { SchedulerRateLimiter } from './services/scheduler-rate-limiter';
import { TaskScheduler } from './services/task-scheduler';
// Services
import { WebSocketManager } from './services/websocket-manager';
import { validateConfiguration } from './config/validate';
import { mockPrisma } from './initializers/mock-prisma';

// Global instances (initialized in start)
let prisma: PrismaClient;
let redis: any;
let wsManager: WebSocketManager;
let heartbeatMonitor: HeartbeatMonitor;
let taskScheduler: TaskScheduler;
let idempotencyService: IdempotencyService;
let priorityScheduler: PriorityScheduler;
let backpressureController: BackpressureController;
let gracefulDegradation: GracefulDegradationService;
let schedulerRateLimiter: SchedulerRateLimiter;
let coldStartHandler: ColdStartHandler;
let secretManager: SecretManager;

// Fastify instance
const app = Fastify({
  logger: false,
  trustProxy: true,
  pluginTimeout: 30000, // 30 seconds for plugin initialization
  bodyLimit: 10 * 1024 * 1024, // 10MB max body size
});

// Development mode flag
const isDevelopment = process.env.NODE_ENV !== 'production';

// Initialize services - use mock Prisma in development if DATABASE_URL is not set or FORCE_MOCK_DB is set
const useMockDb =
  isDevelopment &&
  (!process.env.DATABASE_URL || process.env.FORCE_MOCK_DB === 'true');
prisma = useMockDb ? (mockPrisma as any) : new PrismaClient();

if (useMockDb) {
  logger.info('Using mock database for development (no PostgreSQL required)');
}

// Register plugins
async function registerPlugins() {
  // Security
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        scriptSrc: ["'self'"],
      },
    },
  });

  // CORS configuration with whitelist
  const corsOriginsRaw = await secretManager.getSecret('CORS_ORIGINS');
  const corsOrigins = corsOriginsRaw
    ? corsOriginsRaw.split(',').map((o) => o.trim())
    : isDevelopment
      ? [
          'http://localhost:5173',
          'http://localhost:5174',
          'http://localhost:3000',
        ]
      : [];

  if (!isDevelopment && corsOrigins.length === 0) {
    logger.warn(
      'CORS_ORIGINS not set in production - CORS will block all cross-origin requests',
    );
  }

  await app.register(cors, {
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });

  const jwtSecret = await secretManager.getSecret('JWT_SECRET') || '';
  const jwtExpiresIn = await secretManager.getSecret('JWT_EXPIRES_IN') || '15m';

  await app.register(cookie, {
    secret: jwtSecret,
  });

  await app.register(jwt, {
    secret: jwtSecret,
    sign: {
      expiresIn: jwtExpiresIn,
    },
  });

  const rateLimitMax = parseInt(await secretManager.getSecret('RATE_LIMIT_MAX') || '100', 10);
  const rateLimitWindow = parseInt(await secretManager.getSecret('RATE_LIMIT_WINDOW_MS') || '60000', 10);
  const redisUrlForRateLimit = await secretManager.getSecret('REDIS_URL');

  await app.register(rateLimit, {
    max: async (request: any) => {
      // Adaptive rate limit based on system load
      const limit = await backpressureController.getAdaptiveRateLimit();
      return limit;
    },
    timeWindow: rateLimitWindow,
    cache: 10000,
    allowList: ['127.0.0.1'],
    ...(redisUrlForRateLimit ? { redis: redis } : {}),
  });

  // WebSocket
  await app.register(websocket);

  // Multipart file upload
  const { default: multipart } = await import('@fastify/multipart');
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB max file size
      files: 1, // Max 1 file per request
      fields: 10, // Max 10 non-file fields
    },
  });

  // Swagger/OpenAPI
  await app.register(swaggerPlugin);

  // HTTP request metrics hook
  app.addHook('onResponse', async (request, reply) => {
    const { httpRequestsTotal, httpRequestDuration, httpErrorsTotal } =
      await import('./services/metrics-service.js');
    const route = request.routerPath || request.url;
    const { method } = request;
    const { statusCode } = reply;

    httpRequestsTotal.inc({ method, route, status: statusCode.toString() });
    httpRequestDuration.observe(
      { method, route, status: statusCode.toString() },
      reply.elapsedTime / 1000, // Convert to seconds
    );

    if (statusCode >= 400) {
      const errorType = statusCode >= 500 ? 'server_error' : 'client_error';
      httpErrorsTotal.inc({
        method,
        route,
        status_code: statusCode.toString(),
        error_type: errorType,
      });
    }
  });

  // Custom plugins
  await app.register(prismaPlugin, { prisma });
  await app.register(redisPlugin, { redis });
  await app.register(authPlugin);
  await app.register(errorHandler);
  await app.register(requestLogger);
  
  // API Versioning and Negotiation
  await app.register(versionNegotiationPlugin, {
    supportedVersions: ['v1'],
    defaultVersion: 'v1',
  });

  // Global request ID middleware and standardized logging
  await app.register(fastifyLoggingPlugin, { logger, serviceName: 'orchestrator-api' });

  // Decorate services on fastify instance
  app.decorate('wsManager', wsManager);
  app.decorate('heartbeatMonitor', heartbeatMonitor);
  app.decorate('taskScheduler', taskScheduler);
  app.decorate('idempotencyService', idempotencyService);
  app.decorate('priorityScheduler', priorityScheduler);
  app.decorate('backpressureController', backpressureController);
  app.decorate('gracefulDegradation', gracefulDegradation);
}

// Register routes
async function registerRoutes() {
  const frontendDist = path.resolve(process.cwd(), '..', 'dist');

  // WebSocket route - registered first to take priority over wildcard
  app.get('/ws', { websocket: true }, (socket: any, req: any) => {
    wsManager.handleConnection(socket, req.raw);
  });

  // API V1 Routes
  await app.register(v1Routes, { prefix: '/v1' });

  await app.register(staticPlugin, {
    root: frontendDist,
    prefix: '/',
    wildcard: false,
  });

  app.get('/*', async (request, reply) => {
    const { url } = request;
    if (
      url.startsWith('/api/') ||
      url.startsWith('/docs') ||
      url.startsWith('/ws') ||
      url.startsWith('/assets/')
    ) {
      return reply.callNotFound();
    }
    return reply.sendFile('index.html');
  });

  // Maintenance Endpoints (Outside Versioning)
  app.get('/health', async () => HealthCheck.getLiveness());
  app.get('/health/live', async () => HealthCheck.getLiveness());
  app.get('/health/ready', async () => HealthCheck.getReadiness({
    db: async () => {
      try { await prisma.$queryRaw`SELECT 1`; return true; } catch { return false; }
    },
    redis: async () => {
      try { return (await redis.ping()) === 'PONG'; } catch { return false; }
    }
  }));
  app.get('/health/startup', async () => HealthCheck.getStartup());

  app.get('/version', async () => ({
    service: 'edge-cloud-orchestrator-api',
    version: '2.0.0',
    supportedApiVersions: ['v1'],
  }));
}

// Start server
async function start() {
  secretManager = SecretManagerFactory.create();

  // Validate configuration before starting
  await validateConfiguration(logger, secretManager);

  const dbUrl = await secretManager.getSecret('DATABASE_URL');
  const forceMock = await secretManager.getSecret('FORCE_MOCK_DB') === 'true';
  const useMockDb = isDevelopment && (!dbUrl || forceMock);
  
  prisma = useMockDb ? (mockPrisma as any) : new PrismaClient();

  if (useMockDb) {
    logger.info('Using mock database for development (no PostgreSQL required)');
  }

  const redisUrl = await secretManager.getSecret('REDIS_URL');
  if (redisUrl) {
    const { SLAMonitor } = await import('./services/sla-monitor.js');
    redis = new Redis(redisUrl);
    new SLAMonitor(prisma, redis);
  } else {
    logger.info('Using mock Redis for development');
    const mockStorage = new Map<string, any>();
    redis = {
      get: async (key: string) => mockStorage.get(key) || null,
      set: async (key: string, value: any, ...args: any[]) => { mockStorage.set(key, value); return 'OK'; },
      setex: async (key: string, _s: number, value: any) => { mockStorage.set(key, value); return 'OK'; },
      del: async (...keys: string[]) => { keys.forEach(k => mockStorage.delete(k)); return keys.length; },
      ping: async () => 'PONG',
      publish: async () => 0,
      subscribe: async () => {},
      on: () => redis,
      disconnect: () => {},
      duplicate: () => redis,
      defineCommand: () => {},
      zrange: async () => [],
      zadd: async () => 0,
      zrem: async () => 0,
      zcard: async () => 0,
      lrange: async () => [],
      lpush: async () => 0,
      rpush: async () => 0,
      llen: async () => 0,
      expire: async () => 1,
      ttl: async () => -1,
      keys: async () => [],
      hset: async () => 0,
      hget: async () => null,
      hgetall: async () => null,
      hdel: async () => 0,
      incr: async () => 1,
      incrby: async () => 1,
      setnx: async () => 1,
      pipeline: () => {
        const cmds: any[] = [];
        const p: any = { exec: async () => cmds.map(() => [null, 0]) };
        ['get','set','setex','del','incr','incrby','expire','ttl','zadd','zrem','zrange','zcard','zremrangebyscore','lrange','lpush','rpush','llen','hset','hget','hdel'].forEach(fn => {
          p[fn] = (..._args: any[]) => { cmds.push(fn); return p; };
        });
        return p;
      },
    } as any;
    const { SLAMonitor } = await import('./services/sla-monitor.js');
    new SLAMonitor(prisma, redis);
  }

  wsManager = new WebSocketManager(logger, redis);
  heartbeatMonitor = new HeartbeatMonitor(prisma, redis, wsManager, logger);
  idempotencyService = new IdempotencyService(prisma, redis, logger);
  priorityScheduler = new PriorityScheduler(redis, logger);
  backpressureController = new BackpressureController(redis, logger);
  gracefulDegradation = new GracefulDegradationService(logger);
  schedulerRateLimiter = new SchedulerRateLimiter(redis, logger);
  coldStartHandler = new ColdStartHandler(redis, prisma, logger);
  taskScheduler = new TaskScheduler(prisma, redis, wsManager, logger);

  // Wire up integrations
  taskScheduler.setPriorityScheduler(priorityScheduler);
  taskScheduler.setBackpressureController(backpressureController);
  taskScheduler.setGracefulDegradation(gracefulDegradation);
  taskScheduler.setSchedulerRateLimiter(schedulerRateLimiter);
  taskScheduler.setColdStartHandler(coldStartHandler);

  try {
    await registerPlugins();
    await registerRoutes();
    
    await heartbeatMonitor.start();
    await backpressureController.start();
    priorityScheduler.start();
    gracefulDegradation.start();
    await taskScheduler.start();
    
    await initializeServices(app, prisma, redis, logger, secretManager);

    const port = parseInt(await secretManager.getSecret('PORT') || '3000', 10);
    const host = await secretManager.getSecret('HOST') || '0.0.0.0';

    await app.listen({ port, host });
    
    // Initialize shutdown manager and register handlers
    GracefulShutdown.init();
    GracefulShutdown.registerHandler('app', async () => { await app.close(); });
    GracefulShutdown.registerHandler('services', async () => { await shutdownServices(logger); });
    GracefulShutdown.registerHandler('consumers', async () => {
      if (gracefulDegradation) gracefulDegradation.stop();
      if (priorityScheduler) priorityScheduler.stop();
      if (heartbeatMonitor) heartbeatMonitor.stop();
      if (taskScheduler) taskScheduler.stop();
      if (wsManager) wsManager.close();
    });
    GracefulShutdown.registerHandler('db', async () => {
      if (prisma) await prisma.$disconnect();
      if (redis) redis.disconnect();
    });

    HealthCheck.setReady(true);
    
    logger.info(`🚀 API Gateway running on http://${host}:${port} using ${secretManager.constructor.name}`);
  } catch (err) {
    logger.error(err, 'Failed to start API Gateway');
    process.exit(1);
  }
}

// Start the application
start();

export { app, prisma, redis, wsManager };
