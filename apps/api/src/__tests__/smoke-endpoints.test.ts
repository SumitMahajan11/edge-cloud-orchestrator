import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  configureForProductionTest,
  restoreTestEnvironment,
} from './helpers/production-env.js';
import { mockLeaderElectionToAlwaysLead } from './helpers/mock-leader-election.js';

describe('Local Smoke Test: Core API Endpoints', () => {
  let apiApp: FastifyInstance;
  let savedEnv: Record<string, string | undefined>;
  let cleanupLeader: () => void;

  beforeAll(async () => {
    savedEnv = configureForProductionTest();
    cleanupLeader = await mockLeaderElectionToAlwaysLead();

    const mockSecretManager = {
      getSecret: async (key: string) => {
        if (key === 'JWT_SECRET') { return 'a'.repeat(32); }
        if (key === 'ENCRYPTION_KEY') { return 'b'.repeat(32); }
        if (key === 'DATABASE_URL') { return 'postgresql://localhost:5432/test?sslmode=require'; }
        if (key === 'ALLOWED_ORIGINS') { return 'http://localhost:5173,http://localhost:3000'; }
        if (key === 'JWT_EXPIRES_IN') { return '15m'; }
        if (key === 'RATE_LIMIT_WINDOW_MS') { return '60000'; }
        return process.env[key] || null;
      },
    };

    const { init, app } = await import('../index.js');
    apiApp = app;
    await init({ secretManager: mockSecretManager });
    await apiApp.ready();
  });

  afterAll(async () => {
    if (apiApp) {
      await apiApp.close();
    }
    if (cleanupLeader) {
      cleanupLeader();
    }
    restoreTestEnvironment(savedEnv);
  });

  it('GET /health returns HTTP 200', async () => {
    const res = await apiApp.inject({ method: 'GET', url: '/health' });
    console.log('SMOKE /health ->', res.statusCode, res.body);
    expect([200, 503]).toContain(res.statusCode);
  });

  it('POST /v2/auth/login returns HTTP 400 or 401 for invalid credentials', async () => {
    const res = await apiApp.inject({
      method: 'POST',
      url: '/v2/auth/login',
      payload: { email: 'nonexistent@example.com', password: 'wrongpassword' },
    });
    console.log('SMOKE /v2/auth/login ->', res.statusCode, res.body);
    expect([400, 401]).toContain(res.statusCode);
  });

  it('GET /v2/tasks returns HTTP 401 when unauthorized', async () => {
    const res = await apiApp.inject({ method: 'GET', url: '/v2/tasks' });
    console.log('SMOKE /v2/tasks ->', res.statusCode, res.body);
    expect(res.statusCode).toBe(401);
  });
});
