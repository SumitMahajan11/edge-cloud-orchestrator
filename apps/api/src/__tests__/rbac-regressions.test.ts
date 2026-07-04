import fastify from 'fastify';
import { generateTestToken, TEST_JWT_SECRET } from './helpers/token-factory.js';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

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

describe('RBAC Regression Tests', () => {
  let app: any;

  const mockTaskScheduler = {
    updateCarbonPolicy: vi.fn().mockImplementation((weight) => ({
      success: true,
      carbonWeight: weight,
    })),
  };

  const mockRedis = {
    ping: vi.fn().mockResolvedValue('PONG'),
  };

  const mockPrisma = {
    $disconnect: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
  };

  beforeEach(async () => {
    app = fastify({ logger: false });
    app.decorate('prisma', mockPrisma);
    app.decorate('redis', mockRedis);
    app.decorate('taskScheduler', mockTaskScheduler);

    await app.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await app.register(import('@fastify/rate-limit'), {
      max: 100,
      timeWindow: 60000,
    });

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

  const generateToken = (role = 'OPERATOR', tid = 't1') => {
    return generateTestToken({
      id: '00000000-0000-0000-0000-000000000001',
      email: 't@t.com',
      role,
      tenantId: tid,
    });
  };

  describe('Issue 1: Circuit Breaker and Diagnostic Read Permissions', () => {
    it('should allow OPERATOR to view circuit breakers', async () => {
      const token = generateToken('OPERATOR');
      const response = await app.inject({
        method: 'GET',
        url: '/api/v2/circuit-breakers',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
    });

    it('should allow TENANT_ADMIN to view circuit breakers', async () => {
      const token = generateToken('TENANT_ADMIN');
      const response = await app.inject({
        method: 'GET',
        url: '/api/v2/circuit-breakers',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should allow OPERATOR to view system health', async () => {
      const token = generateToken('OPERATOR');
      const response = await app.inject({
        method: 'GET',
        url: '/api/v2/admin/health',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.database).toBe('healthy');
      expect(body.redis).toBe('healthy');
    });

    it('should allow OPERATOR to view prometheus metrics', async () => {
      const token = generateToken('OPERATOR');
      const response = await app.inject({
        method: 'GET',
        url: '/api/v2/metrics/prometheus',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should block regular USER from viewing circuit breakers', async () => {
      const token = generateToken('USER');
      const response = await app.inject({
        method: 'GET',
        url: '/api/v2/circuit-breakers',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should block OPERATOR from resetting circuit breakers', async () => {
      const token = generateToken('OPERATOR');
      const response = await app.inject({
        method: 'POST',
        url: '/api/v2/circuit-breakers/nonexistent-breaker/reset',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('Issue 2: Carbon Policy Write Permissions', () => {
    it('should block OPERATOR from updating carbon policy', async () => {
      const token = generateToken('OPERATOR');
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v2/carbon/policy',
        headers: { authorization: `Bearer ${token}` },
        payload: { carbonWeight: 0.5 },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should allow TENANT_ADMIN to update carbon policy', async () => {
      const token = generateToken('TENANT_ADMIN');
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v2/carbon/policy',
        headers: { authorization: `Bearer ${token}` },
        payload: { carbonWeight: 0.5 },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.carbonWeight).toBe(0.5);
    });
  });
});
