import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import websocket from '@fastify/websocket'
import staticPlugin from '@fastify/static'
import { PrismaClient } from '@prisma/client'
import pino from 'pino'
import path from 'path'

// Routes
import authRoutes from './routes/auth'
import nodeRoutes from './routes/nodes'
import taskRoutes from './routes/tasks'
import workflowRoutes from './routes/workflows'
import webhookRoutes from './routes/webhooks'
import metricsRoutes from './routes/metrics'
import flRoutes from './routes/federated-learning'
import costRoutes from './routes/cost'
import carbonRoutes from './routes/carbon'
import adminRoutes from './routes/admin'

// Plugins
import { prismaPlugin } from './plugins/prisma'
import { redisPlugin } from './plugins/redis'
import { authPlugin } from './plugins/auth'
import { errorHandler } from './plugins/error-handler'
import { requestLogger } from './plugins/request-logger'
import { createRequestIdMiddleware } from './middleware/request-id-middleware'

// Services
import { WebSocketManager } from './services/websocket-manager'
import { HeartbeatMonitor } from './services/heartbeat-monitor'
import { TaskScheduler } from './services/task-scheduler'
import { ColdStartHandler } from './services/cold-start-handler'
import { PriorityScheduler } from './services/priority-scheduler'
import { BackpressureController } from './services/backpressure-controller'
import { GracefulDegradationService } from './services/graceful-degradation'
import { IdempotencyService } from './services/idempotency-service'
import { SchedulerRateLimiter } from './services/scheduler-rate-limiter'

const logger = pino({
  transport: process.env.NODE_ENV === 'production' 
    ? undefined 
    : { target: 'pino-pretty', options: { colorize: true } },
  level: process.env.LOG_LEVEL || 'info',
})

// Fastify extensions are declared in src/types/fastify.d.ts

const app = Fastify({
  logger: false,
  trustProxy: true,
  pluginTimeout: 30000, // 30 seconds for plugin initialization
})

// Development mode flag
const isDevelopment = process.env.NODE_ENV !== 'production'

// Create mock Prisma for development mode (no database required)
const mockUsers = new Map<string, any>()
const mockSessions = new Map<string, any>()

// Seed mock admin user for development
const mockAdminUser = {
  id: 'dev-admin-001',
  email: 'admin@example.com',
  passwordHash: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.VTtYA.qGZvKG6', // admin123
  name: 'Development Admin',
  role: 'ADMIN',
  isActive: true,
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastLoginAt: null,
}
mockUsers.set(mockAdminUser.email, mockAdminUser)
mockUsers.set(mockAdminUser.id, mockAdminUser)

const mockPrisma = {
  user: {
    findUnique: async ({ where }: any) => {
      if (where.email) return mockUsers.get(where.email) || null
      if (where.id) return mockUsers.get(where.id) || null
      return null
    },
    findFirst: async ({ where }: any) => {
      for (const user of mockUsers.values()) {
        if (where?.apiKey && user.apiKey === where.apiKey) return user
      }
      return null
    },
    create: async ({ data }: any) => {
      const id = data.id || `dev-user-${Date.now()}`
      const user = { ...data, id, createdAt: new Date(), updatedAt: new Date() }
      mockUsers.set(user.email, user)
      mockUsers.set(user.id, user)
      return user
    },
    update: async ({ where, data }: any) => {
      const user = mockUsers.get(where.id) || mockUsers.get(where.email)
      if (!user) throw new Error('User not found')
      const updated = { ...user, ...data, updatedAt: new Date() }
      mockUsers.set(updated.email, updated)
      mockUsers.set(updated.id, updated)
      return updated
    },
    count: async () => mockUsers.size / 2, // Divide by 2 because we store by both email and id
  },
  session: {
    create: async ({ data }: any) => {
      const session = { ...data, id: `dev-session-${Date.now()}`, createdAt: new Date() }
      mockSessions.set(data.refreshToken || data.token, session)
      return session
    },
    findUnique: async ({ where }: any) => {
      return mockSessions.get(where.token) || null
    },
    findFirst: async ({ where }: any) => {
      for (const session of mockSessions.values()) {
        if (where?.refreshToken && session.refreshToken === where.refreshToken) return session
        if (where?.token && session.token === where.token) return session
      }
      return null
    },
    delete: async ({ where }: any) => {
      for (const [key, session] of mockSessions.entries()) {
        if (session.id === where.id) {
          mockSessions.delete(key)
          return session
        }
      }
      return null
    },
    deleteMany: async ({ where }: any) => {
      if (where?.userId) {
        for (const [key, session] of mockSessions.entries()) {
          if (session.userId === where.userId) mockSessions.delete(key)
        }
      }
      return { count: 1 }
    },
  },
  auditLog: {
    create: async ({ data }: any) => ({ id: `dev-audit-${Date.now()}`, ...data }),
  },
  $queryRaw: async () => [{ 1: 1 }],
  $disconnect: async () => {},
} as any

// Initialize services - use mock Prisma in development if DATABASE_URL is not set
const useMockDb = isDevelopment && !process.env.DATABASE_URL
const prisma = useMockDb ? mockPrisma : new PrismaClient()

if (useMockDb) {
  logger.info('Using mock database for development (no PostgreSQL required)')
  logger.info('Mock admin user: admin@example.com / admin123')
}

// Create mock Redis for development (Redis can be added later)
const mockStorage = new Map<string, any>()
const redis = {
  get: async (key: string) => mockStorage.get(key) || null,
  set: async (key: string, value: any) => { mockStorage.set(key, value); return 'OK' },
  setex: async (key: string, seconds: number, value: any) => { mockStorage.set(key, value); return 'OK' },
  del: async (...keys: string[]) => { keys.forEach(k => mockStorage.delete(k)); return keys.length },
  zadd: async () => 1,
  zrem: async () => 1,
  zrevrange: async () => [],
  zrange: async () => [],
  zrevrank: async () => null,
  zcard: async () => 0,
  lpush: async () => 1,
  rpop: async () => null,
  expire: async () => 1,
  ping: async () => 'PONG',
  on: () => {},
  disconnect: () => {},
  eval: async () => 1,
  defineCommand: () => {},
  duplicate: () => ({
    ...redis,
    subscribe: async () => {},
    unsubscribe: async () => {},
    on: () => {},
  }),
  subscribe: async () => {},
  unsubscribe: async () => {},
} as any

const wsManager = new WebSocketManager(logger, redis)
const heartbeatMonitor = new HeartbeatMonitor(prisma, redis, wsManager, logger)

// Initialize new reliability services
const idempotencyService = new IdempotencyService(prisma, redis, logger)
const priorityScheduler = new PriorityScheduler(redis, logger)
const backpressureController = new BackpressureController(redis, logger)
const gracefulDegradation = new GracefulDegradationService(logger)
const schedulerRateLimiter = new SchedulerRateLimiter(redis, logger)
const coldStartHandler = new ColdStartHandler(redis, prisma, logger)

// Initialize main task scheduler with all integrations
const taskScheduler = new TaskScheduler(prisma, redis, wsManager, logger)

// Wire up integrations
taskScheduler.setPriorityScheduler(priorityScheduler)
taskScheduler.setBackpressureController(backpressureController)
taskScheduler.setGracefulDegradation(gracefulDegradation)
taskScheduler.setSchedulerRateLimiter(schedulerRateLimiter)
taskScheduler.setColdStartHandler(coldStartHandler)

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
  })

  await app.register(cors, {
    origin: true, // Allow all origins in development
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  })

  await app.register(cookie, {
    secret: process.env.JWT_SECRET || 'cookie-secret',
  })

  await app.register(jwt, {
    secret: process.env.JWT_SECRET || 'jwt-secret',
    sign: {
      expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    },
  })

  await app.register(rateLimit, {
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    cache: 10000,
    allowList: ['127.0.0.1'],
    redis: redis,
  })

  // WebSocket
  await app.register(websocket)

  // Swagger/OpenAPI
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Edge-Cloud Orchestrator API',
        description: 'Production API for distributed edge-cloud compute orchestration',
        version: '1.0.0',
      },
      servers: [
        { url: 'http://localhost:3000', description: 'Development' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  })

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  })

  // Custom plugins
  await app.register(prismaPlugin, { prisma })
  await app.register(redisPlugin, { redis })
  await app.register(authPlugin)
  await app.register(errorHandler)
  await app.register(requestLogger)

  // Global request ID middleware for tracing
  app.addHook('onRequest', createRequestIdMiddleware(logger))

  // Decorate services on fastify instance
  app.decorate('wsManager', wsManager)
  app.decorate('heartbeatMonitor', heartbeatMonitor)
  app.decorate('taskScheduler', taskScheduler)
  app.decorate('idempotencyService', idempotencyService)
  app.decorate('priorityScheduler', priorityScheduler)
  app.decorate('backpressureController', backpressureController)
  app.decorate('gracefulDegradation', gracefulDegradation)
}

// Register routes
async function registerRoutes() {
  // Serve static frontend files from dist folder
  const frontendDist = path.resolve(process.cwd(), '..', 'dist')
  
  await app.register(staticPlugin, {
    root: frontendDist,
    prefix: '/',
    wildcard: false, // Don't register wildcard route, we'll handle SPA fallback manually
  })

  // SPA fallback - serve index.html for non-API routes
  app.get('/*', async (request, reply) => {
    const url = request.url
    if (url.startsWith('/api/') || url.startsWith('/docs') || url.startsWith('/ws') || url.startsWith('/assets/')) {
      return reply.callNotFound()
    }
    return reply.sendFile('index.html')
  })

  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(nodeRoutes, { prefix: '/api/nodes' })
  await app.register(taskRoutes, { prefix: '/api/tasks' })
  await app.register(workflowRoutes, { prefix: '/api/workflows' })
  await app.register(webhookRoutes, { prefix: '/api/webhooks' })
  await app.register(metricsRoutes, { prefix: '/api/metrics' })
  await app.register(flRoutes, { prefix: '/api/fl' })
  await app.register(costRoutes, { prefix: '/api/cost' })
  await app.register(carbonRoutes, { prefix: '/api/carbon' })
  await app.register(adminRoutes, { prefix: '/api/admin' })

  // Health check
  app.get('/health', async () => ({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  }))

  // Comprehensive health check with all services
  app.get('/health/detailed', async () => {
    const [dbHealth, redisHealth, schedulerHealth] = await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      redis.ping().then(() => true).catch(() => false),
      Promise.resolve(taskScheduler.isCurrentlyLeader()),
    ])

    const degradationLevel = gracefulDegradation.getCurrentLevel()
    const backpressureStatus = backpressureController.getStats()

    return {
      status: dbHealth && redisHealth ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealth ? 'healthy' : 'unhealthy',
        redis: redisHealth ? 'healthy' : 'unhealthy',
        scheduler: {
          isLeader: schedulerHealth,
          queueLength: await taskScheduler.getQueueLength(),
        },
        gracefulDegradation: {
          level: degradationLevel,
          features: gracefulDegradation.getFeatureStates().filter(f => !f.enabled).map(f => f.name),
        },
        backpressure: backpressureStatus,
      },
    }
  })

  // WebSocket endpoint
  app.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, (connection: any, req: any) => {
      wsManager.handleConnection(connection, req)
    })
  })
}

// Start server
async function start() {
  try {
    await registerPlugins()
    await registerRoutes()

    // Start services
    await heartbeatMonitor.start()
    priorityScheduler.start()
    gracefulDegradation.start()
    await taskScheduler.start()

    const port = parseInt(process.env.PORT || '3000', 10)
    const host = process.env.HOST || '0.0.0.0'

    await app.listen({ port, host })
    
    logger.info(`🚀 Edge-Cloud Orchestrator API running on http://${host}:${port}`)
    logger.info(`📚 API Documentation: http://${host}:${port}/docs`)
    logger.info(`🔌 WebSocket: ws://${host}:${port}/ws`)
  } catch (err) {
    logger.error(err, 'Failed to start server')
    process.exit(1)
  }
}

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`)
  
  // Stop all services in reverse order
  gracefulDegradation.stop()
  priorityScheduler.stop()
  heartbeatMonitor.stop()
  taskScheduler.stop()
  wsManager.close()
  
  await app.close()
  await prisma.$disconnect()
  redis.disconnect()
  
  logger.info('Server shutdown complete')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

start()

export { app, prisma, redis, wsManager }
