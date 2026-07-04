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

import { v2Routes } from '../routes/v2-manifest.js';

describe('Metrics Endpoints Integration', () => {
  let app: any;

  const mockPrisma: any = {
    edgeNode: {
      count: vi.fn().mockResolvedValue(5),
      aggregate: vi.fn().mockResolvedValue({ _avg: { latency: 42 } }),
      findMany: vi.fn().mockResolvedValue([{ id: 'node-1', status: 'ONLINE' }]),
    },
    task: {
      count: vi.fn().mockResolvedValue(10),
    },
    costRecord: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { cost: 120.5 } }),
    },
    fLSession: {
      count: vi.fn().mockResolvedValue(3),
    },
    fLModel: {
      count: vi.fn().mockResolvedValue(2),
    },
  };

  beforeEach(async () => {
    app = fastify();
    app.decorate('prisma', mockPrisma);

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
    vi.clearAllMocks();
    await app.close();
  });

  const generateToken = (
    permissions = ['system:read', 'ml:read', 'node:read'],
    tid = 't1',
  ) => {
    return generateTestToken({
      id: '00000000-0000-0000-0000-000000000001',
      email: 't@t.com',
      role: 'USER',
      tenantId: tid,
      permissions: permissions as any[],
    });
  };

  it('GET /api/v2/metrics/system returns system metrics correctly', async () => {
    const token = generateToken();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/metrics/system',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.totalNodes).toBe(5);
    expect(body.onlineNodes).toBe(5);
    expect(body.totalTasks).toBe(10);
    expect(body.pendingTasks).toBe(10);
    expect(body.avgLatency).toBe(42);
    expect(body.totalCost).toBe(120.5);

    // Verify calls used uppercase enum values
    expect(mockPrisma.edgeNode.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ONLINE' }),
      }),
    );
    expect(mockPrisma.task.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
  });

  it('GET /api/v2/metrics delegates to buildSystemMetrics', async () => {
    const token = generateToken();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/metrics',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('totalNodes');
    expect(body).toHaveProperty('totalTasks');
  });

  it('GET /api/v2/metrics/nodes returns online nodes list', async () => {
    const token = generateToken();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/metrics/nodes',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.total).toBe(1);
    expect(body.nodes[0].status).toBe('ONLINE');

    expect(mockPrisma.edgeNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ONLINE' }),
      }),
    );
  });

  it('GET /api/v2/metrics/ml returns federated learning session and model counts', async () => {
    const token = generateToken();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/metrics/ml',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.trainingJobs).toBe(3);
    expect(body.activeModels).toBe(2);

    expect(mockPrisma.fLSession.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'RUNNING' }),
      }),
    );
  });

  it('GET /api/v2/metrics/system succeeds with node:read permission', async () => {
    const token = generateToken(['node:read']);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/metrics/system',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('GET /api/v2/metrics/system succeeds with legacy nodes:* permission due to normalization', async () => {
    const token = generateToken(['nodes:*']);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/metrics/system',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('GET /api/v2/metrics/system fails with 403 if insufficient permissions', async () => {
    const token = generateToken(['tasks:read']);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/metrics/system',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
  });
});
