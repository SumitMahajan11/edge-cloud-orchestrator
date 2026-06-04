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
      async initialize() { return { certificatePem: 'mock' }; }
      getCACertificate() { return 'mock-ca-cert'; }
    },
  }
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

describe('Carbon Endpoints Integration', () => {
  let app: any;

  const mockTaskScheduler = {
    getCarbonIntensityData: vi.fn().mockResolvedValue({
      regions: [
        { zone: 'US-EAST', carbonIntensityGco2: 450, lastUpdatedAt: new Date().toISOString(), source: 'ElectricityMaps' },
        { zone: 'EU-WEST', carbonIntensityGco2: 120, lastUpdatedAt: new Date().toISOString(), source: 'ElectricityMaps' }
      ]
    }),
    updateCarbonPolicy: vi.fn().mockImplementation((weight) => ({
      success: true,
      carbonWeight: weight
    })),
    getCarbonSavingsData: vi.fn(),
    getCarbonPolicyData: vi.fn(),
  };

  beforeEach(async () => {
    app = fastify({ logger: false });
    app.decorate('prisma', { $disconnect: vi.fn() });
    app.decorate('taskScheduler', mockTaskScheduler);
    
    await app.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await app.register(import('@fastify/rate-limit'), { max: 100, timeWindow: 60000 });

    // Register common schemas
    const { ErrorSchema, HealthSchema } = await import('@edgecloud/shared-kernel');
    const { zodToFastifySchema } = await import('../utils/zod-schema.js');
    app.addSchema({ $id: 'ErrorSchema', ...zodToFastifySchema(ErrorSchema) });
    app.addSchema({ $id: 'HealthSchema', ...zodToFastifySchema(HealthSchema) });
    
    const { authenticate, requirePermission, requireRole } = await import('../middleware/auth.middleware.js');
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

  it('Test 1 — GET /api/v2/carbon/intensity returns regions array', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/carbon/intensity',
      headers: { authorization: `Bearer ${generateToken('VIEWER')}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('regions');
    expect(Array.isArray(body.regions)).toBe(true);
    expect(body.regions.length).toBeGreaterThan(0);
  });

  it('Test 2 — GET /api/v2/carbon/savings returns data', async () => {
    mockTaskScheduler.getCarbonSavingsData = vi.fn().mockResolvedValue({
      totalSavedGco2Today: 1500,
      totalSavedGco2Week: 8500
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/carbon/savings',
      headers: { authorization: `Bearer ${generateToken('VIEWER')}` },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).totalSavedGco2Today).toBe(1500);
  });

  it('Test 3 — GET /api/v2/carbon/policy returns data', async () => {
    mockTaskScheduler.getCarbonPolicyData = vi.fn().mockResolvedValue({
      carbonWeight: 0.2,
      isActive: true,
      activePolicy: 'GreenerPaths'
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/carbon/policy',
      headers: { authorization: `Bearer ${generateToken('VIEWER')}` },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).carbonWeight).toBe(0.2);
  });

  it('Test 4 — PATCH /api/v2/carbon/policy validates carbonWeight range (0-1)', async () => {
    // Test upper bound
    const highResponse = await app.inject({
      method: 'PATCH',
      url: '/api/v2/carbon/policy',
      headers: { authorization: `Bearer ${generateToken('TENANT_ADMIN')}` },
      payload: { carbonWeight: 1.5 }
    });
    expect(highResponse.statusCode).toBe(400);

    // Test valid weight
    const validResponse = await app.inject({
      method: 'PATCH',
      url: '/api/v2/carbon/policy',
      headers: { authorization: `Bearer ${generateToken('TENANT_ADMIN')}` },
      payload: { carbonWeight: 0.4 }
    });
    expect(validResponse.statusCode).toBe(200);
    expect(JSON.parse(validResponse.body).carbonWeight).toBe(0.4);
  });

  it('Test 3 — Carbon policy requires CARBON_POLICY_WRITE permission', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v2/carbon/policy',
      headers: { authorization: `Bearer ${generateToken('VIEWER')}` },
      payload: { carbonWeight: 0.5 }
    });
    expect(response.statusCode).toBe(403);
  });
});
