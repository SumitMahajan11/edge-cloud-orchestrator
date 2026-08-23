import type { FastifyInstance } from 'fastify';
import {
  configureForProductionTest,
  restoreTestEnvironment,
} from './helpers/production-env.js';
import { mockLeaderElectionToAlwaysLead } from './helpers/mock-leader-election.js';

describe('Server Lifecycle', () => {
  let apiApp: FastifyInstance;
  let savedEnv: Record<string, string | undefined>;

  beforeAll(async () => {
    savedEnv = configureForProductionTest();
  });

  afterAll(async () => {
    restoreTestEnvironment(savedEnv);
  });

  it('should start and close cleanly without leaving pending timers/handles', async () => {
    const mockSecretManager = {
      getSecret: async (key: string) => {
        if (key === 'JWT_SECRET') return 'a'.repeat(32);
        if (key === 'ENCRYPTION_KEY') return 'b'.repeat(32);
        if (key === 'DATABASE_URL')
          return 'postgresql://localhost:5432/test?sslmode=require';
        if (key === 'ALLOWED_ORIGINS')
          return 'http://localhost:5173,http://localhost:3000';
        if (key === 'JWT_EXPIRES_IN') return '15m';
        if (key === 'RATE_LIMIT_WINDOW_MS') return '60000';
        return process.env[key] || null;
      },
    };

    // Mock BEFORE init() so services don't try to acquire real Redis locks:
    const cleanupLeaderElection = await mockLeaderElectionToAlwaysLead();

    const { init, app } = await import('../index.js');
    apiApp = app;

    // Initialize the server and all background services
    await init({ secretManager: mockSecretManager });
    await apiApp.ready();

    // Verify it is initialized
    expect(apiApp).toBeDefined();

    // Clean shut down
    await apiApp.close();
    cleanupLeaderElection();
  }, 30000);
});
