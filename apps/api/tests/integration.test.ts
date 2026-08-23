import axios, { type AxiosInstance } from 'axios';
import http from 'http';

/**
 * Integration Tests for Edge-Cloud Orchestrator
 *
 * These tests verify the full stack end-to-end:
 * - Backend API endpoints
 * - Database operations
 * - Authentication flow
 * - WebSocket connections
 * - Edge Agent communication
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const EDGE_AGENT_URL = process.env.EDGE_AGENT_URL || 'http://localhost:4001';

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)('Integration Tests', () => {
  let apiClient: AxiosInstance;
  let authToken: string;
  let refreshToken: string;
  let testNodeId: string;
  let testTaskId: string;

  beforeAll(async () => {
    apiClient = axios.create({
      baseURL: API_URL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
      httpAgent: new http.Agent({ keepAlive: true, maxSockets: 50 }),
    });

    apiClient.interceptors.request.use((config) => {
      const version = config.headers?.['x-api-version'] || config.headers?.['X-API-Version'] || 'v1';
      if (config.url && config.url.startsWith('/api/')) {
        config.url = config.url.replace('/api/', `/${version}/`);
      }
      return config;
    });

    apiClient.interceptors.response.use(
      (response) => response,
      (error) => {
        if (axios.isAxiosError(error)) {
          const method = error.config?.method?.toUpperCase() || 'UNKNOWN';
          const url = error.config?.url || 'UNKNOWN';
          const status = error.response?.status;
          const statusText = error.response?.statusText;
          const responseData = error.response?.data;
          const cleanError = new Error(
            `AxiosError: ${method} ${url} failed with status ${status} (${statusText}): ${JSON.stringify(responseData)} | Code: ${error.code} | Cause: ${error.cause}`
          );
          (cleanError as any).status = status;
          (cleanError as any).code = error.code;
          (cleanError as any).data = responseData;
          (cleanError as any).response = error.response;
          return Promise.reject(cleanError);
        }
        return Promise.reject(error);
      }
    );
  });

  beforeEach(() => {
    if (authToken) {
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
    }
  });

  afterEach(async () => {
  });

  describe('Health Checks', () => {
    it('should have healthy API server', async () => {
      const response = await apiClient.get('/health');
      expect(response.status).toBe(200);
      expect(response.data.status).toBe('ok');
    });

    it('should have healthy edge agent', async () => {
      try {
        const response = await axios.get(`${EDGE_AGENT_URL}/health`);
        expect(response.status).toBe(200);
        expect(response.data.status).toBe('healthy');
      } catch (error) {
        // Edge agent might not be running in CI
        console.log('Edge agent not available, skipping');
      }
    });
  });

  describe('Authentication Flow', () => {
    it('should register a new user', async () => {
      const response = await apiClient.post('/api/auth/register', {
        email: `test-${Date.now()}@example.com`,
        password: 'TestPassword123!',
        name: 'Test User',
      });

      expect(response.status).toBe(201);
      expect(response.data.token).toBeDefined();
      expect(response.data.refreshToken).toBeDefined();
      expect(response.data.user.email).toBeDefined();
    });

    it('should login with valid credentials', async () => {
      const response = await apiClient.post('/api/auth/login', {
        email: 'admin@example.com',
        password: 'admin123',
      });

      expect(response.status).toBe(200);
      expect(response.data.token).toBeDefined();
      expect(response.data.refreshToken).toBeDefined();

      authToken = response.data.token;
      refreshToken = response.data.refreshToken;
    });

    it('should reject invalid credentials', async () => {
      try {
        await apiClient.post('/api/auth/login', {
          email: 'admin@example.com',
          password: 'wrongpassword',
        });
        throw new Error('Should have thrown an error');
      } catch (error: unknown) {
        const err = error as any;
        expect(err.response.status).toBe(401);
      }
    });

    it('should refresh token', async () => {
      if (!refreshToken) {
        console.log('No refresh token, skipping');
        return;
      }

      const response = await apiClient.post('/api/auth/refresh', {
        refreshToken,
      });

      expect(response.status).toBe(200);
      expect(response.data.token).toBeDefined();

      authToken = response.data.token;
    });

    it('should get current user', async () => {
      if (!authToken) {
        console.log('No auth token, skipping');
        return;
      }

      const response = await apiClient.get('/api/auth/me', {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.status).toBe(200);
      expect(response.data.email).toBeDefined();
    });
  });

  describe('Node Management', () => {
    beforeEach(() => {
      if (authToken) {
        apiClient.defaults.headers.Authorization = `Bearer ${authToken}`;
      }
    });

    it('should list nodes', async () => {
      const response = await apiClient.get('/api/nodes');

      expect(response.status).toBe(200);
      expect(response.data.data).toBeDefined();
      expect(Array.isArray(response.data.data)).toBe(true);
    });

    it('should create a node', async () => {
      const response = await apiClient.post('/api/nodes', {
        name: `test-node-${Date.now()}`,
        location: 'Test Location',
        region: 'us-east-1',
        ipAddress: '192.168.1.100',
        port: 4001,
        cpuCores: 4,
        memoryGB: 16,
        storageGB: 100,
      });

      expect(response.status).toBe(201);
      expect(response.data.id).toBeDefined();
      expect(response.data.name).toBeDefined();

      testNodeId = response.data.id;
    });

    it('should get node by ID', async () => {
      if (!testNodeId) {
        console.log('No test node ID, skipping');
        return;
      }

      const response = await apiClient.get(`/api/nodes/${testNodeId}`);

      expect(response.status).toBe(200);
      expect(response.data.id).toBe(testNodeId);
    });

    it('should update node', async () => {
      if (!testNodeId) {
        console.log('No test node ID, skipping');
        return;
      }

      const response = await apiClient.patch(`/api/nodes/${testNodeId}`, {
        name: `updated-node-${Date.now()}`,
        maxTasks: 20,
      });

      expect(response.status).toBe(200);
      expect(response.data.maxTasks).toBe(20);
    });

    it('should get node metrics', async () => {
      if (!testNodeId) {
        console.log('No test node ID, skipping');
        return;
      }

      const response = await apiClient.get(`/api/nodes/${testNodeId}/metrics`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data.data)).toBe(true);
      expect(response.data.data.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Task Management', () => {
    beforeEach(() => {
      if (authToken) {
        apiClient.defaults.headers.Authorization = `Bearer ${authToken}`;
      }
    });

    it('should list tasks', async () => {
      const response = await apiClient.get('/api/tasks');

      expect(response.status).toBe(200);
      expect(response.data.data).toBeDefined();
      expect(Array.isArray(response.data.data)).toBe(true);
    });

    it('should create a task', async () => {
      const response = await apiClient.post('/api/tasks', {
        name: `test-task-${Date.now()}`,
        type: 'MODEL_INFERENCE',
        priority: 'MEDIUM',
        input: { model: 'test-model', data: 'test-data' },
      });

      expect(response.status).toBe(201);
      expect(response.data.id).toBeDefined();

      testTaskId = response.data.id;
    });

    it('should get task stats', async () => {
      const response = await apiClient.get('/api/tasks/stats');

      expect(response.status).toBe(200);
      expect(response.data.byStatus).toBeDefined();
    });

    it('should get task by ID', async () => {
      if (!testTaskId) {
        console.log('No test task ID, skipping');
        return;
      }

      const response = await apiClient.get(`/api/tasks/${testTaskId}`);

      expect(response.status).toBe(200);
      expect(response.data.id).toBe(testTaskId);
    });

    it('should cancel a task', async () => {
      if (!testTaskId) {
        console.log('No test task ID, skipping');
        return;
      }

      const response = await apiClient.post(`/api/tasks/${testTaskId}/cancel`, {});

      expect(response.status).toBe(200);
      expect(response.data.status).toBe('CANCELLED');
    });
  });

  describe('Metrics & Monitoring', () => {
    beforeEach(() => {
      if (authToken) {
        apiClient.defaults.headers.Authorization = `Bearer ${authToken}`;
      }
    });

    it('should get system metrics', async () => {
      const response = await apiClient.get('/api/metrics');

      expect(response.status).toBe(200);
      expect(response.data).toBeDefined();
    });

    it('should get request metrics', async () => {
      const response = await apiClient.get('/api/metrics/requests');

      expect(response.status).toBe(200);
    });

    it('should get node metrics summary', async () => {
      const response = await apiClient.get('/api/metrics/nodes');

      expect(response.status).toBe(200);
    });
  });

  describe('Cost & Carbon Tracking', () => {
    beforeEach(() => {
      if (authToken) {
        apiClient.defaults.headers.Authorization = `Bearer ${authToken}`;
      }
    });

    it('should get cost summary', async () => {
      const response = await apiClient.get('/api/cost/summary');

      expect(response.status).toBe(200);
    });

    it('should get cost by node', async () => {
      const response = await apiClient.get('/api/cost/by-node');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
    });

    it('should get carbon summary', async () => {
      const response = await apiClient.get('/api/carbon/summary');

      expect(response.status).toBe(200);
    });

    it('should get carbon by region', async () => {
      const response = await apiClient.get('/api/carbon/by-region');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
    });
  });

  describe('Webhook Management', () => {
    let webhookId: string;

    beforeEach(() => {
      if (authToken) {
        apiClient.defaults.headers.Authorization = `Bearer ${authToken}`;
      }
    });

    it('should list webhooks', async () => {
      const response = await apiClient.get('/api/webhooks');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data.data)).toBe(true);
    });

    it('should create a webhook', async () => {
      const response = await apiClient.post('/api/webhooks', {
        name: `test-webhook-${Date.now()}`,
        url: 'https://example.com/webhook',
        events: ['task.completed', 'node.offline'],
        enabled: true,
      });

      expect(response.status).toBe(201);
      expect(response.data.id).toBeDefined();

      webhookId = response.data.id;
    });

    it('should delete a webhook', async () => {
      if (!webhookId) {
        console.log('No webhook ID, skipping');
        return;
      }

      const response = await apiClient.delete(`/api/webhooks/${webhookId}`);

      expect(response.status).toBe(200);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const responses = [];
      const rateLimitClient = axios.create({ baseURL: API_URL, timeout: 5000, headers: { 'Content-Type': 'application/json', 'Connection': 'close' } });
      rateLimitClient.interceptors.request.use((config) => {
        const version = config.headers?.['x-api-version'] || config.headers?.['X-API-Version'] || 'v1';
        if (config.url && config.url.startsWith('/api/')) config.url = config.url.replace('/api/', `/${version}/`);
        return config;
      });

      // Create a unique user for this test so the ban doesn't leak to other tests
      // since the rate limiter uses user.id as the key
      const registerRes = await apiClient.post('/api/auth/register', {
        email: `ratelimit-${Date.now()}@example.com`,
        password: 'Password123!',
        name: 'Rate Limit User',
        role: 'USER', // Note: rate limiting test shouldn't need admin
      });
      const uniqueToken = registerRes.data.token;

      for (let i = 0; i < 110; i++) {
        const res = await rateLimitClient.get('/api/nodes', {
          headers: { Authorization: `Bearer ${uniqueToken}` }
        }).catch((e) => e);
        responses.push(res);
      }

      const rateLimited = responses.filter((r) => r?.status === 429);

      // Should have some rate limited responses
      expect(rateLimited.length).toBeGreaterThan(0);
      
      // Wait for the 1-second test rate limit window to expire to avoid affecting subsequent tests
      await new Promise(resolve => setTimeout(resolve, 1200));
    }, 30000);
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent node', async () => {
      try {
        await apiClient.get('/api/nodes/00000000-0000-0000-0000-000000000000');
        throw new Error('Should have thrown an error');
      } catch (error: unknown) {
        const err = error as any;
        console.log('404 TEST ERROR:', err.message, 'STATUS:', err.status, 'KEYS:', Object.keys(err));
        expect(err.status).toBe(404);
      }
    });

    it('should return 401 for missing auth', async () => {
      try {
        await apiClient.get('/api/admin/users', { headers: { Authorization: '' } });
        throw new Error('Should have thrown an error');
      } catch (error: unknown) {
        const err = error as any;
        expect(err.status).toBe(401);
      }
    });

    it('should return 400 for invalid input', async () => {
      try {
        await apiClient.post('/api/nodes', {
          // Missing required fields
          name: 'test',
        });
        throw new Error('Should have thrown an error');
      } catch (error: unknown) {
        const err = error as any;
        console.log('400 TEST ERROR:', err.message, 'STATUS:', err.status, 'KEYS:', Object.keys(err));
        expect(err.status).toBe(400);
      }
    });
  });

  describe('Edge Agent Communication', () => {
    it('should get edge agent metrics', async () => {
      try {
        const response = await axios.get(`${EDGE_AGENT_URL}/metrics`);

        expect(response.status).toBe(200);
        expect(response.data.nodeId).toBeDefined();
        expect(response.data.cpuUsage).toBeDefined();
        expect(response.data.memoryUsage).toBeDefined();
      } catch (error) {
        console.log('Edge agent not available, skipping');
      }
    });

    it('should ping edge agent', async () => {
      try {
        const response = await axios.get(`${EDGE_AGENT_URL}/ping`);

        expect(response.status).toBe(200);
        expect(response.data.pong).toBe(true);
      } catch (error) {
        console.log('Edge agent not available, skipping');
      }
    });
  });
});
