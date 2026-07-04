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

// Mock logger
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
  },
}));

vi.mock('../../services/mtls-authentication.js', () => ({
  CertificateAuthorityManager: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue({ certificatePem: 'mock' }),
    getCACertificate: vi.fn().mockReturnValue('mock-ca-cert'),
  })),
  AgentRegistrationService: vi.fn().mockImplementation(() => ({
    registerAgent: vi.fn(),
  })),
}));

vi.mock('@edgecloud/event-bus', () => ({
  EventBus: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { v2Routes } from '../v2-manifest.js';

describe('Governance Analytics Routes', () => {
  let app: any;
  const tenantId = 'tenant-123';

  const mockPrisma: any = {
    schedulingPolicy: {
      count: vi.fn().mockResolvedValue(0),
    },
    alertRule: {
      count: vi.fn().mockResolvedValue(0),
    },
    edgeNode: {
      findMany: vi.fn(),
    },
    nodeHealthScore: {
      findMany: vi.fn(),
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

    app.decorateRequest('tPrisma', {
      getter: function (this: any) {
        return mockPrisma;
      },
    });

    app.decorate('dbCircuitBreaker', { execute: vi.fn((cb: any) => cb()) });
    app.decorate('redis', {
      get: vi.fn(),
      set: vi.fn(),
      ping: vi.fn().mockResolvedValue('PONG'),
    });

    await app.register(import('@fastify/jwt'), { secret: JWT_SECRET });

    const { authenticate, requirePermission, requireRole } =
      await import('../../middleware/auth.middleware.js');
    app.decorate('authenticate', authenticate);
    app.decorate('requirePermission', requirePermission);
    app.decorate('requireRole', requireRole);

    const { ErrorSchema } = await import('@edgecloud/shared-kernel');
    const { zodToFastifySchema } = await import('../../utils/zod-schema.js');
    app.addSchema({ $id: 'ErrorSchema', ...zodToFastifySchema(ErrorSchema) });

    await app.register(v2Routes, { prefix: '/v2' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  const getViewerToken = () => {
    return generateTestToken({
      id: 'user-1',
      email: 'test@test.com',
      role: 'VIEWER',
      tenantId,
    });
  };

  it('should calculate 0% compliance and count offline nodes as policy violations when all nodes are offline', async () => {
    // 3 nodes, all offline
    mockPrisma.edgeNode.findMany.mockResolvedValue([
      { id: 'node-1', status: 'OFFLINE' },
      { id: 'node-2', status: 'OFFLINE' },
      { id: 'node-3', status: 'OFFLINE' },
    ]);

    // No health score entries
    mockPrisma.nodeHealthScore.findMany.mockResolvedValue([]);

    const response = await app.inject({
      method: 'GET',
      url: '/v2/analytics/governance',
      headers: { authorization: `Bearer ${getViewerToken()}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.complianceScore).toBe(0);
    expect(body.policyViolations).toBe(3); // 3 offline nodes
    expect(body.totalNodes).toBe(3);
    expect(body.onlineNodes).toBe(0);
  });

  it('should calculate correct compliance and violations for mixed online/offline and anomalous nodes', async () => {
    // 3 nodes: 2 online, 1 offline
    mockPrisma.edgeNode.findMany.mockResolvedValue([
      { id: 'node-1', status: 'ONLINE' },
      { id: 'node-2', status: 'ONLINE' },
      { id: 'node-3', status: 'OFFLINE' },
    ]);

    // node-1: online, successRate 100%, isAnomaly = false
    // node-2: online, successRate 50%, isAnomaly = true
    mockPrisma.nodeHealthScore.findMany.mockResolvedValue([
      { nodeId: 'node-1', successRate: 1.0, isAnomaly: false },
      { nodeId: 'node-2', successRate: 0.5, isAnomaly: true },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/v2/analytics/governance',
      headers: { authorization: `Bearer ${getViewerToken()}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    // compliance score = (totalComplianceSum / totalNodes) * 100
    // node-1 (online) contributes 1.0
    // node-2 (online) contributes 0.5
    // node-3 (offline) contributes 0.0
    // total = 1.5. divided by 3 totalNodes = 0.5 * 100 = 50%
    expect(body.complianceScore).toBe(50);
    
    // violations = 1 offline node (node-3) + 1 online node with anomaly (node-2) = 2
    expect(body.policyViolations).toBe(2);
    expect(body.totalNodes).toBe(3);
    expect(body.onlineNodes).toBe(2);
  });

  it('should handle zero nodes registered scenario gracefully by returning 0% compliance', async () => {
    mockPrisma.edgeNode.findMany.mockResolvedValue([]);
    mockPrisma.nodeHealthScore.findMany.mockResolvedValue([]);

    const response = await app.inject({
      method: 'GET',
      url: '/v2/analytics/governance',
      headers: { authorization: `Bearer ${getViewerToken()}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.complianceScore).toBe(0);
    expect(body.policyViolations).toBe(0);
    expect(body.totalNodes).toBe(0);
    expect(body.onlineNodes).toBe(0);
  });
});
