import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { WebSocketManager } from '../websocket-manager';
import type { TenantId } from '../../types/fastify.js';

const TEST_SECRET = 'a'.repeat(32);

vi.mock('../../config/env', () => ({
  env: {
    JWT_SECRET: 'a'.repeat(32),
    NODE_ENV: 'test',
    REDIS_URL: 'redis://localhost:6379',
  },
}));

describe('WebSocket Tenant Isolation Audit', () => {
  let wsManager: WebSocketManager;
  let mockLogger: any;
  let mockRedis: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    mockRedis = {
      publish: vi.fn().mockResolvedValue(1),
      psubscribe: vi.fn().mockResolvedValue('OK'),
      on: vi.fn(),
      duplicate: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockResolvedValue('OK'),
    };

    wsManager = new WebSocketManager(mockLogger, mockRedis);
  });

  const createMockWs = () => ({
    on: vi.fn(),
    send: vi.fn(),
    readyState: 1, // OPEN
    close: vi.fn(),
    terminate: vi.fn(),
  });

  const createMockReq = (token: string) => ({
    url: `/ws?token=${token}`,
    headers: { host: 'localhost' },
  });

  /**
   * Fix Verification 1: UUID tenant ID must no longer be misclassified as
   * excludeClientId. After the broadcast signature fix, passing a UUID as
   * the third argument is always treated as tenantId, scoping the Redis
   * channel to `{event}:{tenantId}`. Client B (a different tenant's ADMIN)
   * subscribes to '*' but the local broadcast targets the scoped channel
   * name — which '*' does not match — so Client B receives nothing.
   */
  it('Fix 1: tenant-scoped broadcast MUST NOT leak to a different tenant admin', async () => {
    const tenantAUuid = 'db0a33c2-4756-42ea-8259-7b3b7543a75a';
    const tenantBUuid = '77f722a4-df83-4903-b09e-7119e83fe848';

    // Client A — admin for Tenant A, subscribed to '*'
    const tokenA = jwt.sign(
      { id: 'admin-a', tenantId: tenantAUuid, role: 'ADMIN' },
      TEST_SECRET
    );
    const mockWsA = createMockWs();
    await wsManager.handleConnection(mockWsA as any, createMockReq(tokenA) as any);

    // Client B — admin for Tenant B, also subscribed to '*'
    const tokenB = jwt.sign(
      { id: 'admin-b', tenantId: tenantBUuid, role: 'ADMIN' },
      TEST_SECRET
    );
    const mockWsB = createMockWs();
    await wsManager.handleConnection(mockWsB as any, createMockReq(tokenB) as any);

    // Broadcast an event scoped to Tenant A using its UUID tenantId.
    // Previously the UUID was misclassified as excludeClientId, making this
    // a global broadcast. After the fix the third arg is always tenantId,
    // so the effective channel is 'node:anomaly-detected:db0a33c2-...'.
    wsManager.broadcast(
      'node:anomaly-detected',
      { nodeId: 'node-1', successRate: 0.5 },
      tenantAUuid
    );

    // Client A should receive the event on the scoped channel
    const receivedA = mockWsA.send.mock.calls.map((c: any) => JSON.parse(c[0]));
    const anomalyA = receivedA.filter((m: any) =>
      m.type === `node:anomaly-detected:${tenantAUuid}`
    );
    expect(anomalyA.length).toBe(1);

    // Client B MUST receive zero messages — cross-tenant leak is eliminated
    const receivedB = mockWsB.send.mock.calls.map((c: any) => JSON.parse(c[0]));
    const anomalyB = receivedB.filter((m: any) =>
      m.type === 'node:anomaly-detected' ||
      m.type === `node:anomaly-detected:${tenantAUuid}`
    );
    expect(anomalyB.length).toBe(0);
  });

  /**
   * Regression guard 2: `broadcastToTenant` bypasses Redis pub/sub and delivers
   * only to locally-connected clients on this instance. This is a known
   * single-instance limitation — acceptable for the current single-replica
   * deployment. This test documents the gap so any future multi-instance
   * deployment knows it must switch to `broadcast(channel, payload, tenantId)`.
   */
  it('Known gap 2: broadcastToTenant does not publish to Redis (single-instance only)', () => {
    wsManager.broadcastToTenant('tenant-a' as TenantId, 'task:created', { taskId: '123' });
    expect(mockRedis.publish).not.toHaveBeenCalled();
  });

  /**
   * Fix Verification 3: HeartbeatMonitor previously broadcast node:status_changed
   * without a tenantId, causing all ADMIN clients to receive every node's status
   * change regardless of tenant. After the fix, HeartbeatMonitor passes
   * node.tenantId, so the broadcast is scoped and Client B receives nothing.
   */
  it('Fix 3: heartbeat node:status_changed MUST NOT leak to a different tenant admin', async () => {
    const tenantAUuid = 'db0a33c2-4756-42ea-8259-7b3b7543a75a';
    const tenantBUuid = '77f722a4-df83-4903-b09e-7119e83fe848';

    // Client A — admin for Tenant A, subscribed to '*'
    const tokenA = jwt.sign(
      { id: 'admin-a', tenantId: tenantAUuid, role: 'ADMIN' },
      TEST_SECRET
    );
    const mockWsA = createMockWs();
    await wsManager.handleConnection(mockWsA as any, createMockReq(tokenA) as any);

    // Client B — admin for Tenant B, subscribed to '*'
    const tokenB = jwt.sign(
      { id: 'admin-b', tenantId: tenantBUuid, role: 'ADMIN' },
      TEST_SECRET
    );
    const mockWsB = createMockWs();
    await wsManager.handleConnection(mockWsB as any, createMockReq(tokenB) as any);

    // Simulate HeartbeatMonitor broadcasting with node.tenantId (the patched behaviour)
    wsManager.broadcast('node:status_changed', {
      nodeId: 'node-A-under-tenant-A',
      status: 'OFFLINE',
      reason: 'heartbeat_timeout',
      timestamp: new Date().toISOString(),
    }, tenantAUuid);

    // Client A should receive the scoped status change
    const receivedA = mockWsA.send.mock.calls.map((c: any) => JSON.parse(c[0]));
    const statusA = receivedA.filter((m: any) =>
      m.type === `node:status_changed:${tenantAUuid}`
    );
    expect(statusA.length).toBe(1);
    expect(statusA[0].payload.nodeId).toBe('node-A-under-tenant-A');

    // Client B MUST receive zero messages
    const receivedB = mockWsB.send.mock.calls.map((c: any) => JSON.parse(c[0]));
    const statusB = receivedB.filter((m: any) =>
      m.type === 'node:status_changed' ||
      m.type === `node:status_changed:${tenantAUuid}`
    );
    expect(statusB.length).toBe(0);
  });
});
