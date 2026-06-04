import { describe, expect, it } from 'vitest';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3001';
const API_KEY = process.env.SMOKE_API_KEY ?? '';

async function fetchWithAuth(path: string, options: RequestInit = {}) {
  const url = `${BASE_URL}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
      ...options.headers,
    },
  });
}

describe('API Integrity Smoke Tests', () => {
  // These tests verify that routes are correctly registered and 
  // sensitive dynamic imports (like EventBus) don't crash the worker
  
  it('GET /api/v2/admin/health should be reachable', async () => {
    const res = await fetchWithAuth('/api/v2/admin/health');
    // If it's a module resolution error, the server usually crashes or returns 500
    // 200 means the module is loaded and logic executed
    expect(res.status).toBe(200);
  });

  it('POST /api/v2/admin/events/republish (invalid entity) should NOT crash with module error', async () => {
    // This endpoint uses dynamic import for @edgecloud/event-bus
    // Even if entityId is invalid, it should return 404/400, NOT a 500 module error
    const res = await fetchWithAuth('/api/v2/admin/events/republish', {
      method: 'POST',
      body: JSON.stringify({
        eventType: 'task.created',
        entityId: '00000000-0000-0000-0000-000000000000'
      })
    });
    
    // 404 is a valid logical response; 500 would suggest a crash
    expect(res.status).not.toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('GET /api/v2/workflows should be reachable', async () => {
    const res = await fetchWithAuth('/api/v2/workflows');
    expect(res.status).toBe(200);
  });

  it('GET /api/v2/ml/drift/current should be reachable', async () => {
    const res = await fetchWithAuth('/api/v2/ml/drift/current');
    expect(res.status).toBe(200);
  });

  it('GET /api/v2/carbon/intensity should be reachable', async () => {
    const res = await fetchWithAuth('/api/v2/carbon/intensity');
    expect(res.status).toBe(200);
  });
});
