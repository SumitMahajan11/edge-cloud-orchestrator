import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.FORCE_MOCK_DB = 'true';
  process.env.FORCE_MOCK_REDIS = 'true';
  process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long';
  process.env.ENCRYPTION_KEY = 'test-key-at-least-32-characters-long';
});

import path from 'path';
import fs from 'fs';
import yaml from 'yaml';
import jwt from 'jsonwebtoken';
import { init, app } from '../../apps/api/src/index';

describe('Edge-Cloud Orchestrator API Contract Suite', () => {
  let openapi: any;
  let testToken: string;
  const v1Routes: { method: string, url: string }[] = [];
  const v2Routes: { method: string, url: string }[] = [];
  const allRoutes: { method: string, url: string }[] = [];

  beforeAll(async () => {
    // Collect all registered routes
    app.addHook('onRoute', (routeOptions) => {
      const route = {
        method: Array.isArray(routeOptions.method) ? routeOptions.method[0] : routeOptions.method as string,
        url: routeOptions.url
      };
      
      allRoutes.push(route);
      if (route.url.startsWith('/v1')) v1Routes.push(route);
      if (route.url.startsWith('/v2')) v2Routes.push(route);
    });

    // Initialize the app (registers plugins, routes, etc.)
    await init();
    await app.ready();


    // Load the committed V2 spec
    const specPath = path.resolve(__dirname, '../../apps/api/openapi-v2.yml');
    const specContent = fs.readFileSync(specPath, 'utf8');
    openapi = yaml.parse(specContent);

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
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('V2 API Contract Verification', () => {
    it('should verify all endpoints in the spec exist in the server', () => {
      for (const [routePath, methods] of Object.entries(openapi.paths)) {
        if (routePath === '/ws') continue; // Skip WebSocket endpoint as it might not be in spec

        for (const [method] of Object.entries(methods as any)) {
          if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
            const normalizedSpecPath = routePath.replace(/\/$/, '');
            const exists = v2Routes.some(r => {
              const normalizedRouteUrl = r.url.replace(/\/$/, '').replace(/\{([^}]+)\}/g, ':$1');
              const normalizedSpecUrl = normalizedSpecPath.replace(/\{([^}]+)\}/g, ':$1');
              return r.method.toLowerCase() === method.toLowerCase() && normalizedRouteUrl === normalizedSpecUrl;
            });
            
            expect(exists, `Endpoint ${method.toUpperCase()} ${routePath} defined in spec but not found in server`).toBe(true);
          }
        }
      }
    });

    it('should verify all v2 server endpoints are in the spec (undocumented check)', () => {
      for (const route of v2Routes) {
        const normalizedServerPath = route.url.replace(/\/$/, '');
        let found = false;
        
        for (const specPath of Object.keys(openapi.paths)) {
          const normalizedSpecPath = specPath.replace(/\/$/, '');
          if (normalizedServerPath.replace(/:([^/]+)/g, '{$1}') === normalizedSpecPath) {
            found = true;
            break;
          }
        }
        
        expect(found, `Undocumented V2 endpoint found in server: ${route.method} ${route.url}`).toBe(true);
      }
    });

    it('should validate core v2 endpoints respond correctly', async () => {
      const testCases = [
        { method: 'GET', url: '/v2/status', expectedStatus: 200 },
        { method: 'GET', url: '/v2/nodes/', expectedStatus: 200 },
        { method: 'GET', url: '/v2/tasks/', expectedStatus: 200 }
      ];

      for (const tc of testCases) {
        const response = await app.inject({
          method: tc.method as any,
          url: tc.url,
          headers: {
            'Authorization': `Bearer ${testToken}`
          }
        });

        if (response.statusCode === 500) {
          console.error(`500 Error for ${tc.method} ${tc.url}:`, response.payload);
        }
        expect(response.statusCode).toBe(tc.expectedStatus);
      }
    });
  });

  describe('Schema Drift Protection', () => {
    it('should match the committed openapi-v2.yml', async () => {
      // 1. Load the committed openapi-v2.yml directly from file to ensure no module-loading artifacts
      const fs = await import('fs');
      const path = await import('path');
      const yamlLib = await import('yaml');
      const openapiContent = fs.readFileSync(path.resolve(__dirname, '../../apps/api/openapi-v2.yml'), 'utf8');
      const openapi = yamlLib.parse(openapiContent);

      // 2. Generate the OpenAPI spec fresh from the running server
      // Give swagger a moment to generate the spec
      await new Promise(resolve => setTimeout(resolve, 500));
      
      let currentFullSpec: any;
      if (typeof (app as any).swagger === 'function') {
        currentFullSpec = (app as any).swagger();
      } else {
        const response = await app.inject({
          method: 'GET',
          url: '/docs/json'
        });
        if (response.statusCode === 200) {
          currentFullSpec = JSON.parse(response.payload);
        }
      }
      
      expect(currentFullSpec, 'Failed to retrieve OpenAPI spec from server').toBeDefined();
      
      const v2Spec: any = {
        openapi: '3.0.3',
        info: openapi.info,
        components: JSON.parse(JSON.stringify(currentFullSpec.components || { securitySchemes: {}, schemas: {} })),
        paths: {}
      };

      for (const [path, methods] of Object.entries(currentFullSpec.paths || {})) {
        if (path.startsWith('/v2/')) {
          v2Spec.paths[path] = JSON.parse(JSON.stringify(methods));
        }
      }

      // Helper to ensure deterministic comparison
      const sortObjectKeys = (obj: any): any => {
        if (Array.isArray(obj)) {
          const mapped = obj.map(sortObjectKeys);
          // Sort arrays of primitives to ensure deterministic comparison of enums, required fields, etc.
          if (mapped.every(i => typeof i === 'string' || typeof i === 'number')) {
            return mapped.sort();
          }
          return mapped;
        }
        if (obj !== null && typeof obj === 'object') {
          return Object.keys(obj).sort().reduce((acc: any, key: string) => {
            acc[key] = sortObjectKeys(obj[key]);
            return acc;
          }, {});
        }
        return obj;
      };


      // Filter expected paths for /v2/ only as well
      const expectedPaths: any = {};
      for (const [path, methods] of Object.entries(openapi.paths || {})) {
        if (path.startsWith('/v2/')) {
          expectedPaths[path] = JSON.parse(JSON.stringify(methods));
        }
      }
      
      const sortedActualPaths = JSON.parse(JSON.stringify(sortObjectKeys(v2Spec.paths)));
      const sortedExpectedPaths = JSON.parse(JSON.stringify(sortObjectKeys(expectedPaths)));
      
      // Write to files for easier debugging if needed
      const fsSync = await import('fs');
      fsSync.writeFileSync('actual_paths.json', JSON.stringify(sortedActualPaths, null, 2));
      fsSync.writeFileSync('expected_paths.json', JSON.stringify(sortedExpectedPaths, null, 2));

      // Use string comparison for final sanity check
      expect(JSON.stringify(sortedActualPaths, null, 2)).toBe(JSON.stringify(sortedExpectedPaths, null, 2));
    });
  });






  describe('V1 API Deprecation Enforcement', () => {
    it('should include Deprecation and Sunset headers on v1 endpoints', async () => {
      const sampleRoutes = v1Routes.filter(r => !r.url.includes(':')).slice(0, 5);
      
      for (const route of sampleRoutes) {
        const response = await app.inject({
          method: route.method as any,
          url: route.url,
          payload: { email: `test-${Math.random()}@example.com`, password: 'Password123!', name: 'Test User' },

          headers: {
            'Authorization': `Bearer ${testToken}`
          }
        });


        expect(response.headers).toHaveProperty('deprecation');
        expect(response.headers['deprecation']).toBe('true');
        expect(response.headers).toHaveProperty('sunset');
      }
    });

    it('should NOT include Deprecation headers on v2 endpoints', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v2/status',
        headers: {
          'Authorization': `Bearer ${testToken}`
        }
      });

      expect(response.headers).not.toHaveProperty('deprecation');
      expect(response.headers).not.toHaveProperty('sunset');
    });
  });
});
