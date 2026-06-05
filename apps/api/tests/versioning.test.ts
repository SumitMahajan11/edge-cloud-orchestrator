/// <reference types="vitest" />
import { describe, it, expect } from 'vitest';

const API_URL =
  (typeof process !== 'undefined' ? process.env.API_URL : null) ||
  'http://localhost:3000';

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)(
  'API Versioning & Deprecation',
  () => {
    async function request(path: string, options: any = {}) {
      const url = `${API_URL}${path}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      const data = await response.json().catch(() => ({}));
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      return {
        status: response.status,
        headers,
        data,
      };
    }

    describe('V1 Deprecation Headers', () => {
      it('should include Deprecation and Sunset headers on /v1 requests', async () => {
        const response = await request('/v1/tasks');

        expect(response.headers['deprecation']).toBe('true');
        expect(response.headers['sunset']).toBeDefined();

        const sunsetDate = new Date(response.headers['sunset'] as string);
        const now = new Date();
        const sixMonthsFromNow = new Date();
        sixMonthsFromNow.setMonth(now.getMonth() + 5); // Roughly 6 months

        expect(sunsetDate.getTime()).toBeGreaterThan(
          sixMonthsFromNow.getTime(),
        );
      });

      it('should include Deprecation headers even on 404s for v1 prefix', async () => {
        const response = await request('/v1/non-existent');
        expect(response.headers['deprecation']).toBe('true');
      });
    });

    describe('V2 Routing', () => {
      it('should NOT include Deprecation headers on /v2 requests', async () => {
        const response = await request('/v2/tasks');

        expect(response.headers['deprecation']).toBeUndefined();
        expect(response.headers['sunset']).toBeUndefined();

        // Verify it reached the v2 handler
        expect(response.data.version).toBe('v2');
      });

      it('should work with X-API-Version header', async () => {
        const response = await request('/v2/tasks', {
          headers: { 'X-API-Version': 'v2' },
        });

        expect(response.status).toBe(200);
        expect(response.data.version).toBe('v2');
      });
    });

    describe('Version Negotiation & Validation', () => {
      it('should return 400 for unsupported versions', async () => {
        const response = await request('/v3/tasks');

        expect(response.status).toBe(400);
        expect(response.data.error).toBe('unsupported_version');
      });

      it('should return 400 for version mismatch between header and URL', async () => {
        const response = await request('/v1/tasks', {
          headers: { 'X-API-Version': 'v2' },
        });

        expect(response.status).toBe(400);
        expect(response.data.error).toBe('version_mismatch');
      });
    });
  },
);
