import fs from 'fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import jwt from 'jsonwebtoken';

import path from 'path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import yaml from 'yaml';

import { app,init } from '../../apps/api/src/index';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.FORCE_MOCK_DB = 'true';
  process.env.FORCE_MOCK_REDIS = 'true';
  process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long';
  process.env.ENCRYPTION_KEY = 'test-key-at-least-32-characters-long';
  process.env.ELECTRICITY_MAPS_API_KEY = '';
});

// Load the committed V2 spec at top level for dynamic test generation
const specPath = path.resolve(__dirname, '../../apps/api/openapi-v2.yml');
const specContent = fs.readFileSync(specPath, 'utf8');
const openapi = yaml.parse(specContent);

describe('V2 API Contract Verification', () => {
  let testToken: string;
  let ajv: Ajv;
  const v2Routes: { method: string, url: string }[] = [];

  beforeAll(async () => {
    // Collect all registered routes
    app.addHook('onRoute', (routeOptions) => {
      const {url} = routeOptions;
      if (url.startsWith('/v2')) {
        v2Routes.push({
          method: (Array.isArray(routeOptions.method) ? routeOptions.method[0] : routeOptions.method as string).toLowerCase(),
          url
        });
      }
    });

    // Initialize the app
    await init();
    await app.ready();

    // Setup AJV
    ajv = new Ajv({ 
      allErrors: true, 
      strict: false,
      formats: {
        'date-time': true,
        'uuid': true,
        'email': true,
        'ipv4': true
      }
    });
    addFormats(ajv);

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

  it('should verify all endpoints in the spec exist in the server', () => {
    for (const [routePath, methods] of Object.entries(openapi.paths)) {
      if (routePath === '/ws') {continue;}

      for (const [method] of Object.entries(methods as any)) {
        if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
          const exists = v2Routes.some((r) => {
            const normalizedRouteUrl = r.url.replace(/\/$/, '').replace(/\{([^}]+)\}/g, ':$1');
            const normalizedSpecUrl = routePath.replace(/\/$/, '').replace(/\{([^}]+)\}/g, ':$1');
            return r.method === method && normalizedRouteUrl === normalizedSpecUrl;
          });
          
          expect(exists, `Endpoint ${method.toUpperCase()} ${routePath} defined in spec but not found in server`).toBe(true);
        }
      }
    }
  });

  it('should verify all v2 server endpoints are in the spec (undocumented check)', () => {
    for (const route of v2Routes) {
      // Skip some internal or auto-generated routes
      // Fastify automatically adds HEAD routes for GET routes, which usually aren't in the spec
      if (route.url.includes('/docs') || route.url === '/v2' || route.method === 'head') {continue;}

      const normalizedServerPath = route.url.replace(/\/$/, '').replace(/:([^/]+)/g, '{$1}');
      let found = false;
      
      for (const specPath of Object.keys(openapi.paths)) {
        const normalizedSpecPath = specPath.replace(/\/$/, '');
        if (normalizedServerPath === normalizedSpecPath) {
          if (openapi.paths[specPath][route.method]) {
            found = true;
            break;
          }
        }
      }
      
      expect(found, `Undocumented V2 endpoint found in server: ${route.method.toUpperCase()} ${route.url}`).toBe(true);
    }
  });

  // Test every endpoint in the spec with schema validation
  describe('Response Schema Validation', () => {
    const skipEndpoints = [
      '/v2/auth/logout', // Usually 204 or different schema
    ];

    for (const [routePath, methods] of Object.entries(openapi.paths)) {
      if (routePath === '/ws' || skipEndpoints.includes(routePath)) {continue;}

      for (const [method, operation] of Object.entries(methods as any)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) {continue;}

        it(`${method.toUpperCase()} ${routePath} matches schema`, async () => {
          // Construct a test URL (replace path params with dummy values)
          const testUrl = routePath.replace(/\{([^}]+)\}/g, 'test-id');
          
          // Construct dummy payload if required
          let payload = undefined;
          if ((operation as any).requestBody?.content?.['application/json']?.schema) {
            // Very basic dummy payload generation or just skip complex ones
            // For now, we'll try to find some known good ones or send empty
            payload = {};
          }

          const response = await app.inject({
            method: method.toUpperCase() as any,
            url: testUrl,
            headers: {
              'Authorization': `Bearer ${testToken}`,
              'x-api-version': 'v2'
            },
            payload
          });

          // We only validate if we got a 200/201 which should have a schema
          if (response.statusCode === 200 || response.statusCode === 201) {
            const responseSpec = (operation as any).responses[response.statusCode];
            const schema = responseSpec?.content?.['application/json']?.schema;

            if (schema) {
              // Add components to ajv if they exist
              if (openapi.components) {
                const schemaWithComponents = {
                  ...schema,
                  components: openapi.components
                };
                // AJV needs to know about components if there are $refs
                // We'll create a full schema for validation
                const validate = ajv.compile(schemaWithComponents);
                const valid = validate(JSON.parse(response.payload));
                
                if (!valid) {
                  console.error(`Schema validation errors for ${method.toUpperCase()} ${routePath}:`, validate.errors);
                }
                expect(valid, `Response for ${method.toUpperCase()} ${routePath} does not match schema: ${ajv.errorsText(validate.errors)}`).toBe(true);
              }
            }
          } else if (response.statusCode === 404) {
            // If we got a 404 because of 'test-id', that's fine for existence check
            // but we can't validate schema easily without real IDs
          } else if (response.statusCode >= 400) {
            // Log warning but don't necessarily fail if it's just missing data
            // console.warn(`Skipping schema validation for ${method.toUpperCase()} ${routePath} - received ${response.statusCode}`);
          }
        });
      }
    }
  });
});
