import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

describe('OpenAPI Specification Contract', () => {
  let openapi: any;

  beforeAll(() => {
    const openapiPath = path.resolve(process.cwd(), 'openapi-v2.yml');
    if (!fs.existsSync(openapiPath)) {
      throw new Error('openapi-v2.yml not found. Run pnpm gen:openapi first.');
    }
    const content = fs.readFileSync(openapiPath, 'utf8');
    openapi = parse(content);
  });

  it('should be a valid OpenAPI 3.0.3 specification', () => {
    expect(openapi.openapi).toBe('3.0.3');
    expect(openapi.info.title).toBe('Edge-Cloud Orchestrator API');
  });

  it('should contain core API paths', () => {
    const paths = Object.keys(openapi.paths);
    expect(paths).toContain('/v2/tasks/');
    expect(paths).toContain('/v2/nodes/');
    expect(paths).toContain('/v2/auth/login');
  });

  it('should have schemas for core routes', () => {
    // Check /v2/tasks GET
    expect(openapi.paths['/v2/tasks/'].get.responses['200']).toBeDefined();
    
    // Check /v2/nodes GET
    expect(openapi.paths['/v2/nodes/'].get.responses['200']).toBeDefined();
    
    // Check /v2/auth/login POST has request body
    expect(openapi.paths['/v2/auth/login'].post.requestBody).toBeDefined();
  });

  it('should have security schemes defined', () => {
    expect(openapi.components.securitySchemes.bearerAuth).toBeDefined();
    expect(openapi.components.securitySchemes.bearerAuth.type).toBe('http');
    expect(openapi.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
  });
});
