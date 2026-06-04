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

const VALID_ID = '00000000-0000-0000-0000-000000000001';
const { mockMtls } = vi.hoisted(() => ({
  mockMtls: {
    AgentRegistrationService: class {
      constructor() {}
    },
    CertificateAuthorityManager: class {
      constructor() {}
      async initialize() { return {}; }
      getCACertificate() { return 'mock-ca-cert'; }
    },
  }
}));

vi.mock('../services/mtls-authentication.js', () => mockMtls);

const VALID_EXEC_ID = '00000000-0000-0000-0000-000000000003';

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

vi.mock('../services/mtls-authentication.js', () => ({
  CertificateAuthorityManager: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue({ certificatePem: 'mock' }),
  })),
  AgentRegistrationService: vi.fn().mockImplementation(() => ({
    registerAgent: vi.fn(),
  })),
}));

import { v2Routes } from '../routes/v2-manifest.js';

describe('Workflow Engine Integration', () => {
  let app: any;
  const tenantId = 'tenant-A';

  const mockPrisma: any = {
    workflow: {
      create: vi.fn().mockImplementation(({ data }) => ({ id: VALID_ID, ...data })),
      findFirst: vi.fn().mockImplementation(({ where }) => {
        if (where.id === VALID_ID && where.tenantId === tenantId) {
          return { 
            id: VALID_ID, 
            name: 'Test Workflow', 
            tenantId,
          };
        }
        return null;
      }),
      findUnique: vi.fn().mockImplementation(({ where }) => {
        if (where.id === VALID_ID) {return { id: VALID_ID, tenantId, definition: {} };}
        return null;
      }),
    },
    workflowExecution: {
      create: vi.fn().mockResolvedValue({ id: VALID_EXEC_ID, status: 'RUNNING' }),
      update: vi.fn().mockResolvedValue({ id: VALID_EXEC_ID, status: 'COMPLETED' }),
      findUnique: vi.fn(),
    },
    task: {
      create: vi.fn().mockResolvedValue({ id: 'task-1' }),
    },
    workflowTaskRun: {
      create: vi.fn().mockResolvedValue({ id: 'run-1' }),
    },
    $disconnect: vi.fn(),
  };

  const mockWorkflowEngine = {
    executeWorkflow: vi.fn().mockResolvedValue(VALID_EXEC_ID),
  };

  beforeEach(async () => {
    app = fastify({ logger: false });
    app.decorate('prisma', mockPrisma);
    
    const { enterWithTenantContext, prismaForTenant } = await import('@edgecloud/shared-kernel');
    app.decorateRequest('tPrisma', {
      getter: function(this: any) {
        const tenantId = this.user?.tenantId;
        const prisma = this.server.prisma;
        if (tenantId && typeof prisma.$extends === 'function') {
          enterWithTenantContext(tenantId);
          return prismaForTenant(prisma, tenantId);
        }
        return prisma;
      }
    });

    app.decorate('workflowEngine', mockWorkflowEngine);
    app.decorate('taskScheduler', { enqueue: vi.fn() });
    app.decorate('wsManager', { broadcastToTenant: vi.fn() });
    
    await app.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await app.register(import('@fastify/rate-limit'), { max: 100, timeWindow: 60000 });
    
    const { ErrorSchema, HealthSchema } = await import('@edgecloud/shared-kernel');
    const { zodToFastifySchema } = await import('../utils/zod-schema.js');
    app.addSchema({ $id: 'ErrorSchema', ...zodToFastifySchema(ErrorSchema) });
    app.addSchema({ $id: 'HealthSchema', ...zodToFastifySchema(HealthSchema) });
    
    const { authenticate, requirePermission, requireRole } = await import('../middleware/auth.middleware.js');
    app.decorate('authenticate', authenticate);
    app.decorate('requirePermission', requirePermission);
    app.decorate('requireRole', requireRole);

    await app.register(v2Routes, { prefix: '/v2' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const generateToken = (tid: string, role = 'USER') => {
    return generateTestToken({
      id: 'u1',
      email: 't@t.com',
      role,
      tenantId: tid,
    });
  };

  it('Test 1 — Create workflow with valid DAG', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v2/workflows',
      headers: { authorization: `Bearer ${generateToken(tenantId)}` },
      payload: {
        name: 'Test Workflow',
        version: '1.0.0',
        nodes: [
          { id: 'n1', name: 'Start', type: 'task', config: {}, inputs: [], outputs: [] }
        ],
        edges: []
      }
    });

    if (response.statusCode !== 201) {console.error('FAIL BODY:', response.body);}
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).name).toBe('Test Workflow');
  });

    it('Test 2 — Reject workflow with cycle', async () => {
      const token = generateToken('t1');
      const response = await app.inject({
        method: 'POST',
        url: '/v2/workflows',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          name: 'Cyclic Workflow',
          version: '1.0.0',
          nodes: [
            { id: 'A', name: 'Task A', type: 'task', config: {}, inputs: [], outputs: [] }
          ],
          edges: [
            { id: 'e1', from: 'A', to: 'A' }
          ]
        }
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe('INVALID_DAG');
    });

  it('Test 3 — Workflow execution gating', async () => {
    const token = generateToken('t1');
    mockPrisma.workflow.findFirst.mockResolvedValue({ id: VALID_ID, tenantId: 't1' });
    
    const response = await app.inject({
      method: 'POST',
      url: `/v2/workflows/${VALID_ID}/execute`,
      headers: { authorization: `Bearer ${token}` },
      payload: { input: { key: 'val' } }
    });

    expect(response.statusCode).toBe(202);
    expect(mockWorkflowEngine.executeWorkflow).toHaveBeenCalledWith(VALID_ID, 't1');
  });

  it('Test 4 — Get workflow status', async () => {
    const token = generateToken('t1');
    mockPrisma.workflowExecution.findUnique.mockResolvedValue({
      id: VALID_EXEC_ID,
      status: 'COMPLETED',
      tenantId: 't1',
      taskRuns: []
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v2/workflows/executions/${VALID_EXEC_ID}`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).status).toBe('COMPLETED');
  });

    it('Test 5 — Workflow tenant isolation on read', async () => {
      const token = generateToken('t2'); // Different tenant
      mockPrisma.workflow.findFirst.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: `/v2/workflows/${VALID_ID}`,
        headers: { authorization: `Bearer ${token}` }
      });

      expect(response.statusCode).toBe(404);
    });

  it('Test 6 — Workflow tenant isolation on execution', async () => {
    const token = generateToken('t2'); 
    mockPrisma.workflow.findFirst.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: `/v2/workflows/${VALID_ID}/execute`,
      headers: { authorization: `Bearer ${token}` },
      payload: { input: {} }
    });

    expect(response.statusCode).toBe(404);
  });
});
