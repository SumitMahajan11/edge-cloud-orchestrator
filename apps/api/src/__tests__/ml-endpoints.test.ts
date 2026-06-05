import fastify from 'fastify';
import { generateTestToken, TEST_JWT_SECRET } from './helpers/token-factory.js';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'a'.repeat(32);
  process.env.JWT_ISSUER = 'edge-cloud-orchestrator';
  process.env.JWT_AUDIENCE = 'edge-cloud-clients';
  process.env.LOG_LEVEL = 'fatal';
  process.env.NODE_ENV = 'test';
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

import v2Routes from '../routes/v2-manifest.js';

const VALID_MODEL_ID = '00000000-0000-0000-0000-000000000001';

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

describe('ML Endpoints Integration', () => {
  let app: any;

  const mockPrisma: any = {
    driftLog: {
      findMany: vi.fn(),
    },
    task: {
      groupBy: vi.fn(),
    },
  };

  const mockTaskScheduler: any = {
    scheduleTask: vi.fn().mockResolvedValue({ id: 'task-1' }),
    getMLDriftState: vi
      .fn()
      .mockResolvedValue({ driftScore: 0.05, isDrifting: false }),
    getMLOutcomeStats: vi.fn().mockResolvedValue({ outcomesBuffered: 100 }),
    triggerMLRetrain: vi.fn().mockResolvedValue({ success: true }),
  };

  beforeEach(async () => {
    app = fastify();

    app.decorate('prisma', mockPrisma);
    app.decorate('taskScheduler', mockTaskScheduler);

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
  });

  const generateToken = (role = 'USER', tid = 't1') => {
    return generateTestToken({
      id: '00000000-0000-0000-0000-000000000001',
      email: 't@t.com',
      role,
      tenantId: tid,
    });
  };

  it('Test 1 — Fetch current drift', async () => {
    const token = generateToken();
    mockPrisma.driftLog.findMany.mockResolvedValue([
      {
        id: 'd1',
        modelId: VALID_MODEL_ID,
        driftScore: 0.12,
        timestamp: new Date(),
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/ml/drift/current',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('Test 2 — Fetch outcome statistics', async () => {
    const token = generateToken();
    mockPrisma.task.groupBy.mockResolvedValue([
      { status: 'COMPLETED', _count: 10 },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/ml/outcomes/stats',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('Test 3 — Retrain model (Permission Gate)', async () => {
    const token = generateToken('TENANT_ADMIN');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/ml/retrain',
      headers: { authorization: `Bearer ${token}` },
      payload: { priority: 'HIGH' },
    });

    expect(response.statusCode).toBe(200);
    expect(mockTaskScheduler.triggerMLRetrain).toHaveBeenCalled();
  });

  it('Test 4 — Reject retrain for standard USER', async () => {
    const token = generateToken('USER');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/ml/retrain',
      headers: { authorization: `Bearer ${token}` },
      payload: { priority: 'HIGH' },
    });

    expect(response.statusCode).toBe(403);
  });
});
