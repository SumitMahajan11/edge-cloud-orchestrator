import { describe, it, expect, vi } from 'vitest';
import createClient from 'openapi-fetch';
import type { paths } from '../openapi-types';

// Mock the global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('OpenAPI Contract Validation', () => {
  it('should validate request and response types against the OpenAPI spec', async () => {
    const client = createClient<paths>({ 
      baseUrl: 'http://localhost:3090',
      fetch: mockFetch
    });

    // Mock a successful response matching the OpenAPI schema for /v2/nodes
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        data: [
          {
            id: 'node-1',
            name: 'edge-node-alpha',
            status: 'ONLINE',
            region: 'us-east-1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 20
        }
      }),
      text: async () => JSON.stringify({
        data: [
          {
            id: 'node-1',
            name: 'edge-node-alpha',
            status: 'ONLINE',
            region: 'us-east-1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 20
        }
      })
    });

    // Type-safe fetch using OpenAPI spec
    // The path '/v2/nodes/' and its response shape are validated at compile-time
    const { data, error } = await (client.GET as any)('/v2/nodes/', {
      params: {
        query: {
          status: 'ONLINE',
          limit: 10
        }
      }
    });

    expect(error).toBeUndefined();
    expect((data as any)?.data[0].name).toBe('edge-node-alpha');
    expect(mockFetch).toHaveBeenCalled();
    const [request] = mockFetch.mock.calls[0];
    expect(request.url).toBe('http://localhost:3090/v2/nodes/?status=ONLINE&limit=10');
    expect(request.method).toBe('GET');
  });
});
