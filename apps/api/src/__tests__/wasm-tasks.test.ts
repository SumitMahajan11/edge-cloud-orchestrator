import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('WASM Task Endpoints Integration', () => {
  let app: any;

  const mockPrisma: any = {
    task: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    edgeNode: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  };

  const mockRedis: any = {
    setex: vi.fn().mockResolvedValue('OK'),
    get: vi.fn(),
  };

  const mockTaskScheduler: any = {
    enqueue: vi.fn().mockResolvedValue(undefined),
    recordTaskSubmission: vi.fn(),
  };

  const mockWsManager: any = {
    broadcastToTenant: vi.fn(),
  };

  beforeEach(async () => {
    app = fastify();

    app.decorate('prisma', mockPrisma);
    app.decorate('redis', mockRedis);
    app.decorate('taskScheduler', mockTaskScheduler);
    app.decorate('wsManager', mockWsManager);

    app.decorateRequest('tPrisma', {
      getter: function (this: any) {
        return this.server.prisma;
      },
    });

    await app.register(import('@fastify/jwt'), {
      secret: TEST_JWT_SECRET,
      issuer: 'edge-cloud-orchestrator',
      audience: 'edge-cloud-clients',
    });
    await app.register(import('@fastify/rate-limit'), {
      max: 100,
      timeWindow: 60000,
    });
    await app.register(import('@fastify/multipart'), {
      limits: { fileSize: 50 * 1024 * 1024 },
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
    vi.restoreAllMocks();
  });

  const generateToken = (role = 'USER', tid = 't1') => {
    return generateTestToken({
      id: '00000000-0000-0000-0000-000000000001',
      email: 't@t.com',
      role,
      tenantId: tid,
    });
  };

  it('GET /v2/tasks/artifacts/:id — Return 404 for non-existent artifact', async () => {
    mockRedis.get.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/tasks/artifacts/non-existent-uuid',
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('GET /v2/tasks/artifacts/:id — Return 200 and WASM buffer', async () => {
    const fakeBase64 = Buffer.from('fake-wasm-binary-content').toString('base64');
    mockRedis.get.mockResolvedValue(fakeBase64);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/tasks/artifacts/some-valid-uuid',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/wasm');
    expect(response.body).toBe('fake-wasm-binary-content');
  });

  it('POST /v2/tasks — Create a WASM task with artifact ID', async () => {
    const token = generateToken('TENANT_ADMIN');
    const mockCreatedTask = {
      id: 'task-uuid-123',
      name: 'WASM Task Test',
      type: 'MODEL_INFERENCE',
      status: 'PENDING',
      priority: 'MEDIUM',
      submittedAt: new Date(),
      image: null,
      wasmArtifactId: 'some-wasm-artifact-uuid',
      runtime: 'WASM',
      affinity: null,
      traceId: null,
      metadata: {},
      executions: [],
    };

    mockPrisma.task.create.mockResolvedValue(mockCreatedTask);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/tasks/',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'WASM Task Test',
        type: 'MODEL_INFERENCE',
        priority: 'MEDIUM',
        runtime: 'WASM',
        wasmArtifactId: 'some-wasm-artifact-uuid',
        input: {},
        maxRetries: 3,
        specs: {
          cpuCores: 1,
          memoryGB: 2,
        },
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.wasmArtifactId).toBe('some-wasm-artifact-uuid');
    expect(body.runtime).toBe('WASM');
    expect(body.image).toBeNull();
  });
});
