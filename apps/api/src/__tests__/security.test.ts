import type { FastifyInstance } from 'fastify';
import {
  configureForProductionTest,
  restoreTestEnvironment,
} from './helpers/production-env.js';
import { mockLeaderElectionToAlwaysLead } from './helpers/mock-leader-election.js';

describe('Security Configuration', () => {
  let apiApp: FastifyInstance;
  let savedEnv: Record<string, string | undefined>;
  let cleanupLeaderElection: () => void;

  beforeAll(async () => {
    // Set environment variables for production test
    savedEnv = configureForProductionTest();

    // Mock BEFORE init() so services don't try to acquire real Redis locks:
    cleanupLeaderElection = await mockLeaderElectionToAlwaysLead();

    const mockSecretManager = {
      getSecret: async (key: string) => {
        if (key === 'JWT_SECRET') {return 'a'.repeat(32);}
        if (key === 'ENCRYPTION_KEY') {return 'b'.repeat(32);}
        if (key === 'DATABASE_URL')
          {return 'postgresql://localhost:5432/test?sslmode=require';}
        if (key === 'ALLOWED_ORIGINS')
          {return 'http://localhost:5173,http://localhost:3000';}
        if (key === 'JWT_EXPIRES_IN') {return '15m';}
        if (key === 'RATE_LIMIT_WINDOW_MS') {return '60000';}
        return process.env[key] || null;
      },
    };

    // Initialize the app (registers plugins and routes)
    const { init, app } = await import('../index.js');
    apiApp = app;
    await init({ secretManager: mockSecretManager });
    // Wait for the app to be ready
    await apiApp.ready();
  });

  afterAll(async () => {
    await apiApp.close();
    if (cleanupLeaderElection) {
      cleanupLeaderElection();
    }
    restoreTestEnvironment(savedEnv);
  });

  describe('GAP 1: CSP Header Completeness', () => {
    it('should have the correct CSP headers on every response', async () => {
      const response = await apiApp.inject({
        method: 'GET',
        url: '/health',
      });

      const csp = response.headers['content-security-policy'] as string;
      expect(csp).toBeDefined();
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("connect-src 'self' wss://*");
      expect(csp).toContain("img-src 'self' data:");
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain('upgrade-insecure-requests');
    });
  });

  describe('GAP 2: CORS Whitelist Verification', () => {
    it('should allow requests from a listed origin', async () => {
      const allowedOrigin = 'http://localhost:5173';
      const response = await apiApp.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: allowedOrigin,
        },
      });

      expect(response.headers['access-control-allow-origin']).toBe(
        allowedOrigin,
      );
    });

    it('should return 403 or block requests from an unlisted origin', async () => {
      const unlistedOrigin = 'http://malicious-site.com';
      const response = await apiApp.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: unlistedOrigin,
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('GAP 3: Rate Limit Headers', () => {
    it('should include rate limit headers in the response', async () => {
      const response = await apiApp.inject({
        method: 'GET',
        url: '/health',
        remoteAddress: '1.2.3.4', // Not in allowList
      });

      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });
  });

  describe('Default Deny Auth Schema Integration', () => {
    it('should return a structured 401 response conforming to ErrorSchema when authentication fails (missing token)', async () => {
      const response = await apiApp.inject({
        method: 'GET',
        url: '/v2/metrics/system',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code', 'UNAUTHORIZED');
      expect(body.error.message).toContain('Default Deny policy');
    });

    it('should return a structured 401 response conforming to ErrorSchema when authentication fails (invalid token)', async () => {
      const response = await apiApp.inject({
        method: 'GET',
        url: '/v2/metrics/system',
        headers: {
          authorization: 'Bearer invalid-token-value',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });

    it('should return a structured 401 response conforming to ErrorSchema when authentication fails (expired token)', async () => {
      const jwt = await import('jsonwebtoken');
      const expiredToken = jwt.default.sign(
        { id: 'user-id', email: 'test@example.com', role: 'VIEWER', tenantId: 'tenant-1' },
        'a'.repeat(32),
        { expiresIn: '-10s', issuer: 'edge-cloud-orchestrator', audience: 'edge-cloud-client' }
      );

      const response = await apiApp.inject({
        method: 'GET',
        url: '/v2/metrics/system',
        headers: {
          authorization: `Bearer ${expiredToken}`,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });
  });

  describe('API Route Hardening & Database Error Mapping', () => {
    it('should catch database errors in buildSystemMetrics, log them, and propagate to globalErrorHandler returning 500 DATABASE_ERROR', async () => {
      const jwt = await import('jsonwebtoken');
      const validToken = jwt.default.sign(
        {
          id: 'user-id',
          email: 'test@example.com',
          role: 'ADMIN',
          tenantId: 'tenant-1',
          permissions: ['node:read'],
        },
        'a'.repeat(32),
        {
          issuer: 'edge-cloud-orchestrator',
          audience: 'edge-cloud-clients',
          expiresIn: '15m',
        }
      );

      // Save original prisma method
      const originalCount = apiApp.prisma.edgeNode.count;

      // Mock to throw database error
      apiApp.prisma.edgeNode.count = (async () => {
        const err = new Error('Raw query failed') as any;
        err.name = 'PrismaClientKnownRequestError';
        err.code = 'P2010';
        throw err;
      }) as any;

      try {
        const response = await apiApp.inject({
          method: 'GET',
          url: '/v2/metrics/system',
          headers: {
            authorization: `Bearer ${validToken}`,
          },
        });

        expect(response.statusCode).toBe(500);
        const body = JSON.parse(response.body);
        expect(body).toHaveProperty('error');
        expect(body.error).toHaveProperty('code', 'DATABASE_ERROR');
        expect(body.error.message).toContain('database error occurred');
      } finally {
        // Restore original method
        apiApp.prisma.edgeNode.count = originalCount;
      }
    });
  });
});

