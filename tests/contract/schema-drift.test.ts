import fs from 'fs';
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
});

describe('Schema Drift Protection', () => {
  beforeAll(async () => {
    await init();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('server spec should match the committed openapi-v2.yml', async () => {
    // 1. Load the committed openapi-v2.yml
    const specPath = path.resolve(__dirname, '../../apps/api/openapi-v2.yml');
    const committedSpecContent = fs.readFileSync(specPath, 'utf8');
    const committedSpec = yaml.parse(committedSpecContent);

    // 2. Generate the OpenAPI spec fresh from the running server
    // Give swagger a moment to generate the spec
    await new Promise((resolve) => setTimeout(resolve, 500));
    
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
    
    // Filter for /v2/ routes only and format it like openapi-v2.yml
    const v2Spec: any = {
      openapi: committedSpec.openapi || '3.0.3',
      info: committedSpec.info,
      paths: {},
      components: currentFullSpec.components || { securitySchemes: {}, schemas: {} }
    };

    // Filter paths
    const paths = Object.keys(currentFullSpec.paths || {}).sort();
    for (const pathKey of paths) {
      if (pathKey.startsWith('/v2/')) {
        v2Spec.paths[pathKey] = currentFullSpec.paths[pathKey];
      }
    }

    // Deterministic sorting of keys
    const sortObjectKeys = (obj: any): any => {
      if (Array.isArray(obj)) {
        return obj.map(sortObjectKeys).sort((a, b) => {
          if (typeof a === 'string' && typeof b === 'string') {return a.localeCompare(b);}
          return 0;
        });
      }
      if (obj !== null && typeof obj === 'object') {
        return Object.keys(obj).sort().reduce((acc: any, key: string) => {
          acc[key] = sortObjectKeys(obj[key]);
          return acc;
        }, {});
      }
      return obj;
    };

    const sortedActual = sortObjectKeys(v2Spec);
    const sortedExpected = sortObjectKeys(committedSpec);

    // If they don't match, we fail loudly
    const actualStr = JSON.stringify(sortedActual, null, 2);
    const expectedStr = JSON.stringify(sortedExpected, null, 2);

    if (actualStr !== expectedStr) {
      // Create a temporary file to show the diff if needed
      fs.writeFileSync('schema_drift_actual.json', actualStr);
      fs.writeFileSync('schema_drift_expected.json', expectedStr);
      
      expect(actualStr, 'OpenAPI spec has drifted! Run "npm run gen:openapi" in apps/api and commit the changes.').toBe(expectedStr);
    }
  });
});
