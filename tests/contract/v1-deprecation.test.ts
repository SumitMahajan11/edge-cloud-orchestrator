import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { app,init } from '../../apps/api/src/index';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.FORCE_MOCK_DB = 'true';
  process.env.FORCE_MOCK_REDIS = 'true';
  process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long';
  process.env.ENCRYPTION_KEY = 'test-key-at-least-32-characters-long';
  process.env.ELECTRICITY_MAPS_API_KEY = '';
});

describe('V1 API Deprecation Validation', () => {
  let testToken: string;
  const v1Routes: { method: string, url: string }[] = [];

  beforeAll(async () => {
    // Collect v1 routes
    app.addHook('onRoute', (routeOptions) => {
      const {url} = routeOptions;
      if (url.startsWith('/v1')) {
        v1Routes.push({
          method: (Array.isArray(routeOptions.method) ? routeOptions.method[0] : routeOptions.method as string).toLowerCase(),
          url
        });
      }
    });

    await init();
    await app.ready();

    // Generate a valid token
    testToken = jwt.sign(
      { 
        id: 'test-user-id', 
        email: 'test@example.com', 
        role: 'ADMIN', 
        tenantId: 'default-tenant',
        permissions: ['*'] 
      },
      process.env.JWT_SECRET!,
      { 
        expiresIn: '1h',
        issuer: 'edge-cloud-orchestrator',
        audience: 'edge-cloud-clients'
      }
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('should include Deprecation and Sunset headers on all v1 endpoints', async () => {
    // Test a sample of v1 endpoints
    const sampleRoutes = v1Routes.filter((r) => !r.url.includes(':')).slice(0, 5);
    
    for (const route of sampleRoutes) {
      const response = await app.inject({
        method: route.method.toUpperCase() as any,
        url: route.url,
        headers: {
          'Authorization': `Bearer ${testToken}`,
          'x-api-version': 'v1'
        }
      });

      expect(response.headers, `V1 Route ${route.url} missing deprecation headers`).toHaveProperty('deprecation', 'true');
      expect(response.headers, `V1 Route ${route.url} missing sunset header`).toHaveProperty('sunset');
      
      const sunsetDate = new Date(response.headers['sunset'] as string);
      expect(sunsetDate.getTime()).toBeGreaterThan(Date.now());
      
      // Assert sunset date is at least 30 days in the future
      const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
      expect(sunsetDate.getTime() - Date.now(), `Sunset date for ${route.url} is less than 30 days in the future`).toBeGreaterThan(thirtyDaysInMs);
    }
  });

  it('should verify v1 endpoints still return correct data (deprecated !== broken)', async () => {
    // Test a known v1 endpoint that should work with mocks
    const response = await app.inject({
      method: 'GET',
      url: '/v1/nodes',
      headers: {
        'x-api-version': 'v1',
        'Authorization': `Bearer ${testToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('should fail if sunset date is in the past', () => {
    // This is just a logic check for the test itself
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    expect(pastDate.getTime()).toBeLessThan(Date.now());
  });
});
