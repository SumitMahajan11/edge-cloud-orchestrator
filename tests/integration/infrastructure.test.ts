import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, teardownTestApp, TestContext } from './helpers';
import * as path from 'path';

describe('Integration Test Infrastructure Verification', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  afterAll(async () => {
    if (ctx) {
      await teardownTestApp(ctx);
    }
  });

  it('should successfully initialize Fastify app and inject health request', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
  });

  it('should utilize a worker-specific SQLite database', () => {
    const dbUrl = process.env.DATABASE_URL;
    expect(dbUrl).toBeDefined();
    expect(dbUrl).toContain('test-');
    expect(dbUrl).toContain('.db');

    const workerId = process.env.VITEST_WORKER_ID || '0';
    const expectedFilename = `test-${workerId}.db`;
    expect(dbUrl).toContain(expectedFilename);
  });

  it('should successfully write and read data in SQLite database', async () => {
    // 1. Create a test user
    const testEmail = `infra-test-${Date.now()}@example.com`;
    const user = await ctx.prisma.user.create({
      data: {
        email: testEmail,
        passwordHash: 'Password123!',
        name: 'Infrastructure Test User',
        role: 'OPERATOR',
      },
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe(testEmail);

    // 2. Query it back
    const retrievedUser = await ctx.prisma.user.findUnique({
      where: { id: user.id },
    });

    expect(retrievedUser).toBeDefined();
    expect(retrievedUser?.email).toBe(testEmail);
  });
});
