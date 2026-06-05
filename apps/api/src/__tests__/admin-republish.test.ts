import fastify from 'fastify';
import { generateTestToken, TEST_JWT_SECRET } from './helpers/token-factory.js';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'a'.repeat(32);
  process.env.JWT_ISSUER = 'edge-cloud-orchestrator';
  process.env.JWT_AUDIENCE = 'edge-cloud-clients';
  process.env.LOG_LEVEL = 'fatal';
  process.env.NODE_ENV = 'test';
  process.env.KAFKA_BROKERS = 'localhost:9092';
  process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
  process.env.ENCRYPTION_KEY = 'a'.repeat(32);
});

const { mockMtls } = vi.hoisted(() => ({
  mockMtls: {
    AgentRegistrationService: class {
      constructor() {}
    },
    CertificateAuthorityManager: class {
      constructor() {}
      async initialize() {
        return { certificatePem: 'mock' };
      }
      getCACertificate() {
        return 'mock-ca-cert';
      }
    },
  },
}));

vi.mock('../services/mtls-authentication.js', () => mockMtls);

const VALID_TASK_ID = '00000000-0000-0000-0000-000000000003';

vi.mock('../lib/logger', () => ({
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
}));

const mockEventBus = {
  connect: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@edgecloud/event-bus', () => ({
  EventBus: vi.fn().mockImplementation(() => mockEventBus),
}));

import v2Routes from '../routes/v2-manifest.js';

describe('Admin Republish Integration', () => {
  let app: any;

  const mockPrisma: any = {
    task: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  };

  beforeEach(async () => {
    app = fastify();

    app.decorate('prisma', mockPrisma);
    app.decorate('redis', { ping: vi.fn().mockResolvedValue('PONG') });

    await app.register(import('@fastify/jwt'), {
      secret: TEST_JWT_SECRET,
      issuer: 'edge-cloud-orchestrator',
      audience: 'edge-cloud-clients',
    });
    await app.register(import('@fastify/rate-limit'), {
      max: 100,
      timeWindow: 60000,
    });

    const { ErrorSchema, HealthSchema } =
      await import('@edgecloud/shared-kernel');
    const { zodToFastifySchema } = await import('../utils/zod-schema.js');
    app.addSchema({ $id: 'ErrorSchema', ...zodToFastifySchema(ErrorSchema) });
    app.addSchema({ $id: 'HealthSchema', ...zodToFastifySchema(HealthSchema) });

    const { authenticate, requirePermission, requireRole } =
      await import('../middleware/auth.middleware.js');
    app.decorate('authenticate', authenticate);
    app.decorate('requirePermission', requirePermission);
    app.decorate('requireRole', requireRole);

    await app.register(v2Routes, { prefix: '/api/v2' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  const generateToken = (role: string, tid = 'SYSTEM') => {
    return generateTestToken({
      id: 'u1',
      email: 'admin@test.com',
      role,
      tenantId: tid,
    });
  };

  it('Test 1 — Republish valid task event', async () => {
    const token = generateToken('SUPER_ADMIN');
    mockPrisma.task.findUnique.mockResolvedValue({
      id: VALID_TASK_ID,
      name: 'Task 1',
      type: 'CUSTOM',
      priority: 'MEDIUM',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/events/republish',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        eventType: 'task.created',
        entityId: VALID_TASK_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockEventBus.publish).toHaveBeenCalled();
  });

  it('Test 2 — Super admin can republish event', async () => {
    const token = generateToken('SUPER_ADMIN');
    mockPrisma.task.findUnique.mockResolvedValue({
      id: VALID_TASK_ID,
      name: 'T1',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/events/republish',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        eventType: 'task.created',
        entityId: VALID_TASK_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockEventBus.publish).toHaveBeenCalled();
  });

  it('Test 3 — Rejects non-existent entity', async () => {
    const token = generateToken('SUPER_ADMIN');
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/events/republish',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        eventType: 'task.created',
        entityId: VALID_TASK_ID,
      },
    });

    expect(response.statusCode).toBe(404);
  });

  it('Test 4 — Rejects tenant-scoped tokens', async () => {
    const token = generateToken('SUPER_ADMIN', 'tenant-1'); // Not SYSTEM

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/events/republish',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        eventType: 'task.created',
        entityId: VALID_TASK_ID,
      },
    });

    expect(response.statusCode).toBe(403);
  });
});
