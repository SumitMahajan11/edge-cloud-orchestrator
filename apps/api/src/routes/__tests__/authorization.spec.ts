import fastify from 'fastify';
import { generateTestToken } from '../../__tests__/helpers/token-factory.js';

vi.hoisted(() => {
  process.env.LOG_LEVEL = 'fatal';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'a'.repeat(32);
  process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
  process.env.ENCRYPTION_KEY = 'a'.repeat(32);
});

const { JWT_SECRET } = vi.hoisted(() => ({
  JWT_SECRET: 'a'.repeat(32),
}));

// Mock logger COMPLETELY to avoid pino initialization issues in tests
vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
  logRequest: vi.fn(),
  logError: vi.fn(),
  logAudit: vi.fn(),
  logPerformance: vi.fn(),
}));

vi.mock('../../config/env', () => ({
  env: {
    JWT_SECRET,
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    LOG_FORMAT: 'json',
    JWT_ISSUER: 'edge-cloud-orchestrator',
    JWT_AUDIENCE: 'edge-cloud-clients',
    DATABASE_URL: 'postgresql://localhost:5432/test',
    ENCRYPTION_KEY: 'a'.repeat(32),
    KAFKA_BROKERS: 'localhost:9092',
  },
}));

// Mock mtls-authentication to avoid initialization crash
vi.mock('../../services/mtls-authentication.js', () => ({
  CertificateAuthorityManager: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue({ certificatePem: 'mock' }),
    getCACertificate: vi.fn().mockReturnValue('mock-ca-cert'),
  })),
  AgentRegistrationService: vi.fn().mockImplementation(() => ({
    registerAgent: vi.fn(),
  })),
}));

// Mock event-bus to avoid Kafka connection
vi.mock('@edgecloud/event-bus', () => ({
  EventBus: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { v2Routes } from '../v2-manifest.js';

describe('Granular RBAC Authorization Suite', () => {
  let app: any;
  const tenantId = 'tenant-123';
  const mockTaskId = '00000000-0000-0000-0000-000000000001';
  const mockNodeId = '00000000-0000-0000-0000-000000000002';

  const mockPrisma: any = {
    task: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation((d) => ({
        id: mockTaskId,
        name: d.data.name,
        type: d.data.type,
        status: 'PENDING',
        priority: d.data.priority || 'MEDIUM',
        target: d.data.target || 'EDGE',
        runtime: d.data.runtime || 'DOCKER',
        image: d.data.image,
        submittedAt: new Date(),
        metadata: d.data.metadata || {},
        executions: [],
      })),
      findUnique: vi.fn().mockResolvedValue({
        id: mockTaskId,
        tenantId,
        name: 'Test',
        type: 'CUSTOM',
      }),
      update: vi.fn().mockResolvedValue({ id: mockTaskId }),
    },
    edgeNode: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue({
        id: mockNodeId,
        status: 'ONLINE',
        isMaintenanceMode: false,
      }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    deadLetterEvent: {
      findUnique: vi.fn().mockResolvedValue({ id: 'dlq-1', status: 'PENDING' }),
      update: vi.fn().mockResolvedValue({ id: 'dlq-1' }),
      groupBy: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn(async (cb) =>
      typeof cb === 'function' ? cb(mockPrisma) : cb,
    ),
    isMock: true,
  };

  beforeEach(async () => {
    app = fastify({ logger: false });

    app.decorate('prisma', mockPrisma);

    const { enterWithTenantContext, prismaForTenant } =
      await import('@edgecloud/shared-kernel');
    app.decorateRequest('tPrisma', {
      getter: function (this: any) {
        const tenantId = this.user?.tenantId;
        const prisma = this.server.prisma;
        if (tenantId && typeof prisma.$extends === 'function') {
          enterWithTenantContext(tenantId);
          return prismaForTenant(prisma, tenantId);
        }
        return prisma;
      },
    });

    app.decorate('dbCircuitBreaker', { execute: vi.fn((cb: any) => cb()) });
    app.decorate('redis', {
      get: vi.fn(),
      set: vi.fn(),
      ping: vi.fn().mockResolvedValue('PONG'),
    });
    app.decorate('taskScheduler', {
      enqueue: vi.fn(),
      recordTaskSubmission: vi.fn(),
      triggerMLRetrain: vi.fn().mockResolvedValue({ success: true }),
      getMLDriftState: vi.fn().mockResolvedValue({ driftScore: 0 }),
      featureExtractor: {
        extractTrainingData: vi.fn().mockResolvedValue(new Array(60).fill({})),
      },
      modelRegistry: { promoteModel: vi.fn() },
    });
    app.decorate('wsManager', {
      broadcast: vi.fn(),
      broadcastToTenant: vi.fn(),
    });
    app.decorate('rateLimitService', {
      checkLimit: vi.fn().mockResolvedValue({ allowed: true }),
    });
    app.decorate('backpressureController', {
      isOverloaded: vi.fn().mockReturnValue(false),
    });
    app.decorate('gracefulDegradation', {
      isDegraded: vi.fn().mockReturnValue(false),
    });
    app.decorate('apiKeyService', { validateApiKey: vi.fn() });

    await app.register(import('@fastify/jwt'), { secret: JWT_SECRET });

    const { authenticate, requirePermission, requireRole } =
      await import('../../middleware/auth.middleware.js');
    app.decorate('authenticate', authenticate);
    app.decorate('requirePermission', requirePermission);
    app.decorate('requireRole', requireRole);

    const { ErrorSchema, HealthSchema } =
      await import('@edgecloud/shared-kernel');
    const { zodToFastifySchema } = await import('../../utils/zod-schema.js');
    app.addSchema({ $id: 'ErrorSchema', ...zodToFastifySchema(ErrorSchema) });
    app.addSchema({ $id: 'HealthSchema', ...zodToFastifySchema(HealthSchema) });

    await app.register(v2Routes, { prefix: '/v2' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const generateToken = (role: string, customTenantId: string = tenantId) => {
    return generateTestToken({
      id: 'user-1',
      email: 'test@test.com',
      role,
      tenantId: customTenantId,
    });
  };

  describe('VIEWER Role', () => {
    it('should ALLOW reading tasks', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v2/tasks',
        headers: { authorization: `Bearer ${generateToken('VIEWER')}` },
      });
      expect(response.statusCode).toBe(200);
    });

    it('should DENY creating tasks', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v2/tasks',
        headers: { authorization: `Bearer ${generateToken('VIEWER')}` },
        payload: { name: 'Test', type: 'CUSTOM', image: 'test' },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('USER Role', () => {
    it('should ALLOW creating tasks', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v2/tasks',
        headers: { authorization: `Bearer ${generateToken('USER')}` },
        payload: {
          name: 'Test Task',
          type: 'CUSTOM',
          image: 'test-image',
          runtime: 'DOCKER',
          priority: 'MEDIUM',
          target: 'EDGE',
        },
      });
      expect(response.statusCode).toBe(201);
    });

    it('should DENY triggering ML retraining (Admin permission)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v2/ml/retrain',
        headers: { authorization: `Bearer ${generateToken('USER')}` },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('TENANT_ADMIN Role', () => {
    it('should ALLOW reading audit logs', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v2/admin/audit-logs',
        headers: { authorization: `Bearer ${generateToken('TENANT_ADMIN')}` },
      });
      expect(response.statusCode).toBe(200);
    });

    it('should DENY system-wide actions (even with Admin role if tenant-scoped)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v2/admin/events/republish',
        headers: {
          authorization: `Bearer ${generateToken('TENANT_ADMIN', 'tenant-123')}`,
        },
        payload: { eventType: 'task.created', entityId: mockTaskId },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('SUPER_ADMIN Role', () => {
    it('should ALLOW system-wide actions with SYSTEM tenantId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v2/admin/events/republish',
        headers: {
          authorization: `Bearer ${generateToken('SUPER_ADMIN', 'SYSTEM')}`,
        },
        payload: { eventType: 'task.created', entityId: mockTaskId },
      });
      expect(response.statusCode).toBe(200);
    });
  });
});
