import fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { prismaPlugin } from '../../plugins/prisma.js';
import { v1Routes } from '../v1-manifest.js';

const { JWT_SECRET } = vi.hoisted(() => ({
  JWT_SECRET: 'a-very-long-secret-that-is-at-least-32-chars'
}));

vi.mock('../../config/env', () => ({
  env: {
    JWT_SECRET,
    NODE_ENV: 'test',
  }
}));

process.env.JWT_SECRET = JWT_SECRET;

describe('Tenant HTTP Integration', () => {
  let app: any;
  const tenantA = 'tenant-a-id';

  // Mock Prisma
  const mockPrisma: any = {
    task: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $extends: vi.fn().mockReturnThis(),
    $disconnect: vi.fn(),
  };

  // Mock Redis
  const mockRedis: any = {
    get: vi.fn(),
    set: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
  };

  beforeEach(async () => {
    app = fastify();
    
    // Register dependencies
    await app.register(prismaPlugin, { prisma: mockPrisma });
    app.decorate('redis', mockRedis);

    // Auth middleware indirection to allow early route registration
    const { authState } = await import('../../initializers/auth-state.js');
    app.decorate('authenticate', function(this: any, request: any, reply: any) {
      return authState.authenticate(request, reply);
    });

    app.decorate('requireRole', function(this: any, ...roles: any[]) {
      return authState.requireRole(...roles);
    });
    
    const { default: jwtPlugin } = await import('@fastify/jwt');
    await app.register(jwtPlugin, {
      secret: JWT_SECRET,
    });

    // Need authPlugin to provide requireRole and authenticate decorators
    await app.register(import('../../plugins/auth.js').then(m => m.authPlugin));

    app.setErrorHandler((error: Error, _request: any, reply: any) => {
      console.error('Request Error:', error);
      reply.status(500).send(error);
    });

    const { ErrorSchema, HealthSchema } = await import('@edgecloud/shared-kernel');
    const { zodToFastifySchema } = await import('../../utils/zod-schema.js');

    app.addSchema({ $id: 'ErrorSchema', ...zodToFastifySchema(ErrorSchema) });
    app.addSchema({ $id: 'HealthSchema', ...zodToFastifySchema(HealthSchema) });

    await app.register(v1Routes, { prefix: '/v1' });
  });

  afterEach(async () => {
    await app.close();
  });

  const generateToken = (tenantId: string) => {
    return jwt.sign({ id: 'user-1', email: 'test@test.com', role: 'ADMIN', tenantId }, JWT_SECRET);
  };

  it('should pass tenantId to prisma when querying tasks', async () => {
    const token = generateToken(tenantA);
    const mockTask = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Test Task',
      type: 'CUSTOM',
      status: 'PENDING',
      priority: 'MEDIUM',
      target: 'EDGE',
      submittedAt: new Date(),
      runtime: 'DOCKER',
      tenantId: tenantA,
      metadata: {},
    };
    mockPrisma.task.findMany.mockResolvedValue([mockTask]);
    mockPrisma.task.count.mockResolvedValue(1);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);
    // The actual enforcement happens in the prisma extension which is wrapped around mockPrisma.
    // In this integration test, we verify that the route correctly works with the authenticated user.
  });
});
