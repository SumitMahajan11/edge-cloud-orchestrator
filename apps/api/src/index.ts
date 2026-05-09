import 'reflect-metadata';
import { initTracing } from '@edgecloud/observability';
initTracing('api', process.env.npm_package_version || '1.0.0');
import { env } from './config/env';
import { 
  initTelemetry, 
  createLogger, 
  fastifyLoggingPlugin,
  SecretManagerFactory, 
  SecretManager,
  GracefulShutdown,
  HealthCheck,
  RedisFactory,
  API_CONSTANTS
} from '@edgecloud/shared-kernel';
initTelemetry('orchestrator-api');

const logger = createLogger('orchestrator-api');
export let secretManager: SecretManager = SecretManagerFactory.create();

/**
 * Global Error Handlers
 * 
 * EADDRINUSE is the only exception we handle specifically because it is a common
 * infrastructure collision that occurs during startup before any application state
 * is corrupted. All other errors must be allowed to crash the process to prevent
 * running in an indeterminate or corrupted state.
 */
process.on('uncaughtException', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    logger.fatal({ port: env.PORT }, 'Port already in use. Please ensure no other instances of the API are running.');
    process.exit(1);
  }
  
  // For all other errors, we log and re-throw to allow normal crash behavior
  // which surfaces the stack trace and triggers a supervisor restart.
  logger.fatal({ err }, 'Uncaught exception detected - crashing process to ensure integrity');
  throw err;
});

process.on('unhandledRejection', (reason: any) => {
  // Treat unhandled rejections as fatal to maintain system integrity
  logger.fatal({ reason }, 'Unhandled rejection detected - crashing process to ensure integrity');
  throw reason;
});


import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import websocket from '@fastify/websocket';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import path from 'path';

import {
  initializeServices,
  shutdownServices,
} from './initializers/services.js';
import { errorHandler } from './plugins/error-handler';
import { v1Routes } from './routes/v1-manifest';
import { v2Routes } from './routes/v2-manifest';
import { BackpressureController } from './services/backpressure-controller';

import { GracefulDegradationService } from './services/graceful-degradation';
import { HeartbeatMonitor } from './services/heartbeat-monitor';
import { IdempotencyService } from './services/idempotency-service';
import { PriorityScheduler } from './services/priority-scheduler';
import { SchedulerRateLimiter } from './services/scheduler-rate-limiter';
import { TaskScheduler } from './services/task-scheduler';
// Services
import { WebSocketManager } from './services/websocket-manager';
import { mockPrisma } from './initializers/mock-prisma';
import { WebhookRetryJob } from './jobs/webhook-retry';
import { ConsistencyCheckerJob } from './jobs/consistency-checker';
import { AuthService } from './services/auth.service';
import { RateLimitService } from './services/rate-limit.service';


// Global instances (initialized in start)
export let prisma: PrismaClient;
export let redis: any;
export let wsManager: WebSocketManager;
export let heartbeatMonitor: HeartbeatMonitor;
export let taskScheduler: TaskScheduler;
export let idempotencyService: IdempotencyService;
export let priorityScheduler: PriorityScheduler;
export let backpressureController: BackpressureController;
export let gracefulDegradation: GracefulDegradationService;
export let schedulerRateLimiter: SchedulerRateLimiter;


let lastRedisHealthy: number = Date.now();
let webhookRetryJob: WebhookRetryJob;
let consistencyCheckerJob: ConsistencyCheckerJob;

const isDevelopment = env.NODE_ENV !== 'production';

// Fastify instance
const app = Fastify({
  logger: false,
  trustProxy: env.TRUST_PROXY || (isDevelopment ? true : false),
  pluginTimeout: API_CONSTANTS.PLUGIN_TIMEOUT_MS,
  bodyLimit: API_CONSTANTS.BODY_LIMIT_BYTES,
});

import { authState } from './initializers/auth-state';

// Auth middleware indirection to allow early route registration
app.decorate('authenticate', function(this: any, request: any, reply: any) {
  return authState.authenticate(request, reply);
});

app.decorate('requireRole', function(this: any, ...roles: any[]) {
  return authState.requireRole(...roles);
});

/**
 * Global 'Default Deny' Authentication Hook
 * 
 * This hook runs before any route-level preHandlers.
 * It enforces authentication for all routes unless they are explicitly
 * marked as public in their route configuration.
 */
  app.addHook('preHandler', async (request, reply) => {
    // 1. Check if route is explicitly marked as public
    const isPublic = request.routeOptions.config?.public === true;
    if (isPublic) return;

    // 2. Public health and documentation routes (bypass by path pattern)
    const url = request.url;
    if (
      url.startsWith('/health') || 
      url === '/version' || 
      url.startsWith('/docs') ||
      url === '/ws'
    ) {
      return;
    }

    // 3. Default Deny: Authenticate if not explicitly public
    // This ensures that any newly added routes are secure by default.
    try {
      await (app as any).authenticate(request, reply);
    } catch (err: any) {
      request.log.error({ err, url }, 'Global authentication hook failed');
      return reply.status(401).send({ 
        error: 'Authentication required',
        message: 'This endpoint is protected by Default Deny policy.'
      });
    }
  });


app.addHook('onRequest', async (request: any, reply: any) => {
  if (!request || !request.headers) return;
  const supportedVersions = ['v1', 'v2'];
  const defaultVersion = 'v1';
  const headerVersion = request.headers['x-api-version'];
  const url = request.url || '';
  const urlParts = url.split('/');
  const urlVersion = urlParts.find((p: string) => /^v\d+$/.test(p));
  const requestedVersion = (headerVersion as string) || urlVersion || defaultVersion;

  if (!supportedVersions.includes(requestedVersion)) {
    return reply.code(400).send({
      error: 'unsupported_version',
      message: `API version ${requestedVersion} is not supported.`,
      supported: supportedVersions,
    });
  }

  request.apiVersion = requestedVersion;
});

app.addHook('onSend', async (request: any, reply: any, payload: any) => {
  if (request && request.apiVersion === 'v1' && reply) {
    reply.header('Deprecation', 'true');
    const sunsetDate = new Date();
    sunsetDate.setMonth(sunsetDate.getMonth() + 6);
    reply.header('Sunset', sunsetDate.toUTCString());
  }
  return payload;
});


app.decorateRequest('apiVersion', '');

// Register global schemas for $ref resolution
import { ErrorSchema, HealthSchema } from '@edgecloud/shared-kernel';
import { zodToFastifySchema } from './utils/zod-schema';

app.addSchema({ $id: 'ErrorSchema', ...zodToFastifySchema(ErrorSchema) });
app.addSchema({ $id: 'HealthSchema', ...zodToFastifySchema(HealthSchema) });

app.addHook('onError', async (request, _reply, error) => {
  const method = request?.method || 'unknown';
  const url = request?.url || 'unknown';
  console.error(`GLOBAL ERROR [${method} ${url}]:`, error);
});


// Development mode flag




// Register plugins
async function registerPlugins() {
  // Security
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", "wss://*"],
        imgSrc: ["'self'", "data:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  });

  // CORS configuration with whitelist
  const corsOriginsRaw = env.ALLOWED_ORIGINS;
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
      'ALLOWED_ORIGINS not set in production - CORS will block all cross-origin requests',
    );
  }

  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) {
        cb(null, true);
        return;
      }

      if (corsOrigins.includes(origin) || isDevelopment) {
        cb(null, true);
        return;
      }

      const error = new Error('Not allowed by CORS') as any;
      error.statusCode = 403;
      cb(error, false);
    },
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

  const rateLimitWindow = parseInt(await secretManager.getSecret('RATE_LIMIT_WINDOW_MS') || '60000', 10);
  const redisUrlForRateLimit = await secretManager.getSecret('REDIS_URL');

  await app.register(rateLimit, {
    max: async () => {
      // Adaptive rate limit based on system load
      const limit = await backpressureController.getAdaptiveRateLimit();
      return limit;
    },
    timeWindow: rateLimitWindow,
    cache: 10000,
    allowList: ['127.0.0.1'],
    ...(redisUrlForRateLimit ? { redis: redis } : {}),
    keyGenerator: (request) => {
      return (request as any).user?.id || request.ip;
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true
    }
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
  const swagger = await import('@fastify/swagger');
  await app.register(swagger.default, {
    openapi: {
      info: {
        title: 'Edge-Cloud Orchestrator API',
        description: 'Production API documentation for the Edge-Cloud Orchestrator Control Plane',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    }
  });

  const swaggerUi = await import('@fastify/swagger-ui');
  await app.register(swaggerUi.default, {
    routePrefix: '/docs',
  });


  // HTTP request metrics hook
  app.addHook('onResponse', async (request, reply) => {
    if (!request || !reply) return;
    try {
      const { httpRequestsTotal, httpRequestDuration, httpErrorsTotal } =
        await import('./services/metrics-service.js');
      const route = (request as any).routerPath || request.url || 'unknown';
      const { method } = request;
      const { statusCode } = reply;

      if (httpRequestsTotal) {
        httpRequestsTotal.inc({ method, route, status: statusCode.toString() });
      }
      if (httpRequestDuration) {
        httpRequestDuration.observe(
          { method, route, status: statusCode.toString() },
          reply.elapsedTime / 1000, // Convert to seconds
        );
      }

      if (statusCode >= 400 && httpErrorsTotal) {
        const errorType = statusCode >= 500 ? 'server_error' : 'client_error';
        httpErrorsTotal.inc({
          method,
          route,
          status_code: statusCode.toString(),
          error_type: errorType,
        });
      }
    } catch (e) {
      // Ignore metrics errors to not fail the request
    }
  });


  // Global services decoration (Directly on root app to ensure propagation)
  const isMockPrisma = (prisma as any)?.isMock;
  const { prismaForTenant } = await import('@edgecloud/shared-kernel');
  const scopedPrisma = isMockPrisma ? prisma : prismaForTenant(prisma);
  
  if (!app.hasDecorator('prisma')) {
    app.decorate('prisma', {
      getter: () => isMockPrisma ? prisma : prismaForTenant(prisma)
    });
  }
  
  if (!app.hasDecorator('redis')) {
    app.decorate('redis', {
      getter: () => redis
    });
  }
  
  // 1. Instantiate Auth/RateLimit Services
  const authService = new AuthService(scopedPrisma);
  const rateLimitService = new RateLimitService(redis);
  
  // 2. Decorate instance with services
  app.decorate('authService', authService);
  app.decorate('rateLimitService', rateLimitService);
  
  // 3. Update auth state indirection
  const { authenticate, requireRole } = await import('./middleware/auth.middleware.js');
  authState.authenticate = authenticate;
  authState.requireRole = requireRole;

  // Custom plugins (remaining)
  logger.info('Registering errorHandler...');
  await app.register(errorHandler);





  
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
  app.decorate('schedulerRateLimiter', schedulerRateLimiter);

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

  // API V2 Routes
  // Debug route for mock DB
  app.get('/debug/nodes', async () => {
    if (env.FORCE_MOCK_DB) {
      const { mockNodes } = await import('./initializers/mock-prisma');
      return { count: mockNodes.size, nodeIds: Array.from(mockNodes.keys()) };
    }
    return { error: 'Mock DB not enabled' };
  });

  await app.register(v2Routes, { prefix: '/v2' });

  // OpenAPI Spec Generation (CLI mode)
  if (env.GEN_OPENAPI) {
    const fs = await import('fs');
    const yamlLib = await import('yaml');
    logger.info('Generating OpenAPI Spec (v2 Only)...');
    await app.ready();
    
    const fullSpec = (app as any).swagger();
    const v2Spec: any = { 
      ...fullSpec, 
      paths: {} 
    };

    // Filter for /v2/ routes and sort them alphabetically for determinism
    const paths = Object.keys(fullSpec.paths || {}).sort();
    for (const pathKey of paths) {
      if (pathKey.startsWith('/v2/')) {
        v2Spec.paths[pathKey] = fullSpec.paths[pathKey];
      }
    }

    const yamlOutput = yamlLib.stringify(v2Spec);
    const targetPath = path.resolve(__dirname, '../openapi-v2.yml');
    fs.writeFileSync(targetPath, yamlOutput);
    
    if (yamlOutput.includes('runtime')) {
      logger.info({ path: targetPath }, 'OpenAPI Spec (v2 Only) generated successfully');
    } else {
      console.warn('WARNING: Generated OpenAPI Spec does not contain "runtime" field. Possible schema mismatch.');
      logger.info({ path: targetPath, size: yamlOutput.length }, 'Spec written successfully');
    }

    if (env.EXIT_AFTER_GEN) {
      process.exit(0);
    }

  }


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

  // Health checks
  app.get('/health', {
    schema: {
      tags: ['system'],
      summary: 'Liveness check',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            version: { type: 'string' }
          }
        }
      }
    }
  }, async () => HealthCheck.getLiveness());

  app.get('/health/live', {
    schema: {
      tags: ['system'],
      summary: 'Enhanced liveness check with Redis monitoring',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            version: { type: 'string' },
            reason: { type: 'string' }
          }
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            reason: { type: 'string' }
          }
        }
      }
    }
  }, async (_request, reply) => {
    const liveness = HealthCheck.getLiveness();
    // Fail liveness if Redis has been unreachable for > 30s
    if (redis && !(redis as any).isMock && Date.now() - lastRedisHealthy > 30000) {
      reply.status(503);
      return { ...liveness, status: 'error', reason: 'Redis unreachable' };
    }
    return liveness;
  });

  app.get('/health/ready', {
    schema: {
      tags: ['system'],
      summary: 'Readiness check (DB + Redis + Circuit Breakers)',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            services: {
              type: 'object',
              properties: {
                db: { 
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    latency: { type: 'string' },
                    circuit: { type: 'string' }
                  }
                },
                redis: { 
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    latency: { type: 'string' }
                  }
                }
              }
            }
          }
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            services: { type: 'object' }
          }
        }
      }
    }
  }, async (_request, reply) => {
    const startDb = Date.now();
    let dbStatus = 'healthy';
    let dbLatency = '0ms';
    const dbCircuit = app.dbCircuitBreaker?.getState() || 'CLOSED';

    if (dbCircuit === 'OPEN') {
      dbStatus = 'degraded';
    } else {
      try {
        await prisma.$queryRaw`SELECT 1`;
        dbLatency = `${Date.now() - startDb}ms`;
      } catch (e) {
        dbStatus = 'unhealthy';
      }
    }

    const startRedis = Date.now();
    let redisStatus = 'healthy';
    let redisLatency = '0ms';
    try {
      await redis.ping();
      redisLatency = `${Date.now() - startRedis}ms`;
    } catch {
      redisStatus = 'unhealthy';
    }

    const isReady = dbStatus === 'healthy' && redisStatus === 'healthy';
    const response = {
      status: isReady ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      services: {
        db: { status: dbStatus, latency: dbLatency, circuit: dbCircuit },
        redis: { status: redisStatus, latency: redisLatency }
      }
    };

    if (!isReady) {
      reply.status(503);
    }
    return response;
  });

  app.get('/health/startup', {
    schema: {
      tags: ['system'],
      summary: 'Startup check',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' }
          }
        }
      }
    }
  }, async () => HealthCheck.getStartup());

  app.get('/version', async () => ({
    service: 'edge-cloud-orchestrator-api',
    version: '2.0.0',
    supportedApiVersions: ['v1', 'v2'],
  }));
}

// Start server
/**
 * Initialize application without listening
 */
export async function init(overrides: any = {}) {
  logger.info('API init() called');

  const secretManagerInstance = overrides.secretManager || SecretManagerFactory.create();
  secretManager = secretManagerInstance;

  // Validate configuration before starting
  // Environment validation is handled by config/env.ts on import

  const jwtSecretStr = await secretManagerInstance.getSecret('JWT_SECRET') || env.JWT_SECRET || '';
  if (jwtSecretStr.length < 32) {
    logger.fatal('JWT_SECRET must be at least 32 characters long for cryptographic security');
    process.exit(1);
  }

  const weakPatterns = ['demo', 'test', 'secret', 'password', '123456'];
  if (weakPatterns.some(p => jwtSecretStr.toLowerCase().includes(p))) {
    if (env.NODE_ENV === 'production') {
      logger.fatal('JWT_SECRET contains a weak pattern and is forbidden in production');
      process.exit(1);
    } else {
      logger.warn('JWT_SECRET contains a weak pattern - acceptable ONLY for local development');
    }
  }

  const dbUrl = await secretManagerInstance.getSecret('DATABASE_URL') || env.DATABASE_URL || '';
  if (env.NODE_ENV === 'production' && !dbUrl.includes('sslmode=') && !dbUrl.includes('ssl=true')) {
    logger.fatal('DATABASE_URL must use SSL in production (e.g., sslmode=require)');
    process.exit(1);
  }

  const forceMock = env.FORCE_MOCK_DB;
  const useMockDb = isDevelopment && (!dbUrl || forceMock);
  
  prisma = useMockDb ? (mockPrisma as any) : new PrismaClient();

  if (useMockDb) {
    logger.info('Using mock database for development (no PostgreSQL required)');
    // Mock axios for node communication in load tests (but not in integration tests)
    if (env.NODE_ENV !== 'test') {
      const { default: axios } = await import('axios');
      (axios as any).post = async (url: string, _data: any) => {
        if (url.includes('/run-task')) {
          return { status: 202, data: { status: 'ACCEPTED' } };
        }
        return { status: 200, data: {} };
      };
    }
  }

  const redisUrl = await secretManager.getSecret('REDIS_URL');
  const redisSentinels = await secretManager.getSecret('REDIS_SENTINELS');
  const forceMockRedis = env.FORCE_MOCK_REDIS;
  
  logger.info({ redisUrl, redisSentinels, forceMockRedis, forceMock }, 'Redis/DB configuration detection');

  if ((redisUrl || redisSentinels) && !forceMockRedis) {
    const { SLAMonitor } = await import('./services/sla-monitor.js');
    redis = await RedisFactory.createClient(secretManager);
    
    // Track Redis health for liveness probe
    redis.on('ready', () => { lastRedisHealthy = Date.now(); });
    setInterval(async () => {
      try {
        await redis.ping();
        lastRedisHealthy = Date.now();
      } catch (err) {
        // Only log if it's been failing for a while
        if (Date.now() - lastRedisHealthy > 10000) {
          logger.warn('Redis health check failing');
        }
      }
    }, 5000);

    new SLAMonitor(prisma, redis);
  } else {
    logger.info('Using mock Redis for development');
    const mockStorage = new Map<string, any>();
    const zsets = new Map<string, { member: string, score: number }[]>();
    
    const baseMockRedis = {
      isMock: true,
      get: async (key: string) => mockStorage.get(key) || null,
      set: async (key: string, value: any, ..._args: any[]) => { mockStorage.set(key, value); return 'OK'; },
      setex: async (key: string, _s: number, value: any) => { mockStorage.set(key, value); return 'OK'; },
      del: async (...keys: string[]) => { keys.forEach(k => { mockStorage.delete(k); zsets.delete(k); }); return keys.length; },
      ping: async () => 'PONG',
      publish: async () => 0,
      subscribe: async () => {},
      on: () => redis,
      off: () => redis,
      quit: async () => 'OK',
      disconnect: () => {},
      duplicate: () => redis,
      defineCommand: () => {},
      zrange: async (key: string, start: number, stop: number) => {
        const set = zsets.get(key) || [];
        const result = set.sort((a, b) => a.score - b.score).slice(start, stop === -1 ? undefined : stop + 1).map(i => i.member);
        logger.debug({ key, start, stop, count: result.length }, '[Redis Mock] zrange');
        return result;
      },
      zrevrange: async (key: string, start: number, stop: number) => {
        const set = zsets.get(key) || [];
        const result = set.sort((a, b) => b.score - a.score).slice(start, stop === -1 ? undefined : stop + 1).map(i => i.member);
        logger.info({ key, start, stop, count: result.length, first: result[0] }, '[Redis Mock] zrevrange');
        return result;
      },
      zrangebyscore: async (key: string, min: number | string, max: number | string) => {
        const set = zsets.get(key) || [];
        const minVal = typeof min === 'string' ? -Infinity : min;
        const maxVal = typeof max === 'string' ? Infinity : max;
        return set.filter(i => i.score >= minVal && i.score <= maxVal).map(i => i.member);
      },
      zpopmin: async (key: string, count: number = 1) => {
        const set = zsets.get(key) || [];
        set.sort((a, b) => a.score - b.score);
        const popped = set.splice(0, count);
        const result: (string | number)[] = [];
        popped.forEach(p => {
          result.push(p.member);
          result.push(p.score);
        });
        logger.debug({ key, count, popped: popped.length }, '[Redis Mock] zpopmin');
        return result;
      },
      zcard: async (key: string) => {
        return (zsets.get(key) || []).length;
      },
      zadd: async (key: string, score: number, member: string) => {
        logger.info({ key, score, member }, '[Redis Mock] zadd');
        let set = zsets.get(key);
        if (!set) { set = []; zsets.set(key, set); }
        const existing = set.find(i => i.member === member);
        if (existing) { existing.score = score; } else { set.push({ member, score }); }
        return 1;
      },
      zrem: async (key: string, ...members: string[]) => {
        const set = zsets.get(key) || [];
        const initialLen = set.length;
        const memberSet = new Set(members);
        const filtered = set.filter(i => !memberSet.has(i.member));
        zsets.set(key, filtered);
        return initialLen - filtered.length;
      },
      zrank: async (key: string, member: string) => {
        const set = zsets.get(key) || [];
        const index = set.sort((a, b) => a.score - b.score).findIndex(i => i.member === member);
        return index === -1 ? null : index;
      },
      zrevrank: async (key: string, member: string) => {
        const set = zsets.get(key) || [];
        const index = set.sort((a, b) => b.score - a.score).findIndex(i => i.member === member);
        return index === -1 ? null : index;
      },
      zremrangebyscore: async (key: string, min: number, max: number) => {
        const set = zsets.get(key);
        if (!set) return 0;
        const initialLen = set.length;
        const newSet = set.filter(i => i.score < min || i.score > max);
        zsets.set(key, newSet);
        return initialLen - newSet.length;
      },
      lrange: async () => [],
      lpush: async () => 0,
      rpush: async () => 0,
      llen: async () => 0,
      lrem: async () => 0,
      expire: async () => 1,
      ttl: async () => -1,
      keys: async () => [],
      hset: async () => 0,
      hget: async () => null,
      hgetall: async () => null,
      hdel: async () => 0,
      incr: async () => 1,
      decr: async () => 0,
      incrby: async () => 1,
      setnx: async () => 1,
      evalsha: async (..._args: any[]) => 1,
      eval: async (..._args: any[]) => 1,
      script: async (..._args: any[]) => 'OK',
      rateLimit: async (..._args: any[]) => [1, 100, 100, -1], // Standard response [allowed, remaining, reset, -1]
      pipeline: () => {
        const cmds: any[] = [];
        const p: any = { exec: async () => cmds.map(() => [null, 0]) };
        [
          'get', 'set', 'setex', 'del', 'incr', 'decr', 'incrby', 'expire', 'ttl', 
          'zadd', 'zrem', 'zrange', 'zrevrange', 'zrangebyscore', 'zcard', 
          'zremrangebyscore', 'zrank', 'zrevrank', 'lrange', 'lpush', 'rpush', 
          'llen', 'lrem', 'hset', 'hget', 'hdel', 'evalsha', 'eval', 'script'
        ].forEach(fn => {
          p[fn] = (..._args: any[]) => { cmds.push(fn); return p; };
        });
        return p;
      },
    };

    // Proxy to catch and warn about missing Redis commands in development
    redis = new Proxy(baseMockRedis, {
      get: (target, prop: string) => {
        logger.debug({ prop }, '[Redis Proxy] Accessing property');
        if (prop in target || typeof prop === 'symbol' || prop.startsWith('_')) {
          return (target as any)[prop];
        }
        logger.warn({ command: prop }, 'Redis command called on mock but not implemented - returning undefined stub');
        return async () => undefined;
      }
    }) as any;
    const { SLAMonitor } = await import('./services/sla-monitor.js');
    new SLAMonitor(prisma, redis);

    // Mock LeaderElection to always be leader in mock mode
    const { LeaderElection } = await import('@edgecloud/shared-kernel');
    LeaderElection.prototype.start = async function(id: string) {
      console.log(`[MockLeaderElection] start called for ${id}`);
      (this as any).isLeader = true;
      this.emit('leadership-acquired');
      return true;
    };
    LeaderElection.prototype.isCurrentlyLeader = function() {
      // console.log('[MockLeaderElection] isCurrentlyLeader called - returning true');
      return true;
    };
  }

  wsManager = new WebSocketManager(logger, redis);
  const { setWebSocketManager } = await import('./utils/circuit-breakers.ts');
  setWebSocketManager(wsManager);
  
  heartbeatMonitor = new HeartbeatMonitor(prisma, redis, wsManager, logger);
  idempotencyService = new IdempotencyService(prisma, redis, logger);
  priorityScheduler = new PriorityScheduler(redis, logger);
  backpressureController = new BackpressureController(redis, logger);
  gracefulDegradation = new GracefulDegradationService(logger);
  schedulerRateLimiter = new SchedulerRateLimiter(redis, logger);

  taskScheduler = new TaskScheduler(prisma, redis, wsManager, logger);
  webhookRetryJob = new WebhookRetryJob(prisma, logger);
  consistencyCheckerJob = new ConsistencyCheckerJob(prisma, logger);

  // Wire up integrations
  taskScheduler.setPriorityScheduler(priorityScheduler);
  taskScheduler.setBackpressureController(backpressureController);
  taskScheduler.setGracefulDegradation(gracefulDegradation);
  taskScheduler.setSchedulerRateLimiter(schedulerRateLimiter);

  heartbeatMonitor.setTaskScheduler(taskScheduler);

  try {
    await registerPlugins();

    await registerRoutes();
    
    // Initialize monitors/schedulers
    await heartbeatMonitor.start();
    await backpressureController.start();
    priorityScheduler.start();
    gracefulDegradation.start();
    await taskScheduler.start();
    webhookRetryJob.start();
    consistencyCheckerJob.start();
    
    await initializeServices(app, prisma, redis, logger, idempotencyService);

    // Monitor mock DB size
    if (env.FORCE_MOCK_DB) {
      setInterval(async () => {
        const { mockNodes } = await import('./initializers/mock-prisma');
        logger.info({ count: mockNodes.size }, '[Debug] mockNodes size');
      }, 5000);
    }
    
    return app;
  } catch (err) {
    console.error('API INITIALIZATION ERROR:', err);
    throw err;
  }
}

/**
 * Start server and listen
 */
export async function start() {
  try {
    await init();

    const port = env.PORT;
    const host = env.HOST;

    await app.listen({ port, host });
    
    // Initialize shutdown manager and register handlers
    GracefulShutdown.init();
    GracefulShutdown.registerHandler('app', async () => { await app.close(); });
    GracefulShutdown.registerHandler('services', async () => { await shutdownServices(logger); });
    GracefulShutdown.registerHandler('db', async () => {
      if (prisma) await prisma.$disconnect();
      if (redis) redis.disconnect();
    });

    HealthCheck.setReady(true);
    
    logger.info(`🚀 API Gateway running on http://${host}:${port}`);
  } catch (err) {
    logger.error(err, 'Failed to start API Gateway');
    process.exit(1);
  }
}




// Start the application if not being imported for tests
if (env.NODE_ENV !== 'test' && !env.VITEST) {
  start().catch(err => {
    logger.error(err, 'Failed to start API Gateway');
    process.exit(1);
  });
}

export { app };
