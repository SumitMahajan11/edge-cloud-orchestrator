import jwt from 'jsonwebtoken';
// using globals for vitest API

import { WebSocketManager } from '../websocket-manager';

const TEST_SECRET = 'a'.repeat(32);

// Mock env
vi.mock('../../config/env', () => ({
  env: {
    JWT_SECRET: 'a'.repeat(32),
    NODE_ENV: 'test',
    REDIS_URL: 'redis://localhost:6379'
  }
}));

describe('WebSocket Manager Tenant Isolation', () => {
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

  it('should automatically subscribe user to their tenant-scoped channels locally', async () => {
    const tenantId = 'tenant-a';
    const token = jwt.sign({ id: 'user-1', tenantId, role: 'USER' }, TEST_SECRET);
    const mockWs = createMockWs();
    const mockReq = createMockReq(token);

    await wsManager.handleConnection(mockWs as any, mockReq as any);

    // Verify Pod-level Redis psubscribe was called with global pattern (from constructor)
    expect(mockRedis.psubscribe).toHaveBeenCalledWith('*:*:*');
    
    // Verify Client-level local subscriptions
    const {clients} = (wsManager as any);
    const client = Array.from(clients.values())[0] as any;
    expect(client.subscriptions.has(`task:created:${tenantId}`)).toBe(true);
    expect(client.subscriptions.has(`node:heartbeat:${tenantId}`)).toBe(true);
  });

  it('should allow SUPER_ADMIN to have wildcard local subscription', async () => {
    const token = jwt.sign({ id: 'admin-1', role: 'SUPER_ADMIN' }, TEST_SECRET);
    const mockWs = createMockWs();
    const mockReq = createMockReq(token);

    await wsManager.handleConnection(mockWs as any, mockReq as any);

    // Verify Client-level local subscriptions
    const {clients} = (wsManager as any);
    const client = Array.from(clients.values())[0] as any;
    expect(client.subscriptions.has('*')).toBe(true);
  });

  it('should prevent Tenant A from subscribing to Tenant B channels', async () => {
    const tenantIdA = 'tenant-a';
    const tenantIdB = 'tenant-b';
    const token = jwt.sign({ id: 'user-1', tenantId: tenantIdA, role: 'USER' }, TEST_SECRET);
    const mockWs = createMockWs();
    const mockReq = createMockReq(token);

    await wsManager.handleConnection(mockWs as any, mockReq as any);
    
    const {clients} = (wsManager as any);
    const client = Array.from(clients.values())[0] as any;
    
    const channel = `task:created:${tenantIdB}`;
    (wsManager as any).handleSubscribe(client, { channels: [channel] });

    // Verify it was NOT added to subscriptions
    expect(client.subscriptions.has(channel)).toBe(false);
  });

  it('should allow Tenant A to subscribe to their own channels', async () => {
    const tenantIdA = 'tenant-a';
    const token = jwt.sign({ id: 'user-1', tenantId: tenantIdA, role: 'USER' }, TEST_SECRET);
    const mockWs = createMockWs();
    const mockReq = createMockReq(token);

    await wsManager.handleConnection(mockWs as any, mockReq as any);
    
    const {clients} = (wsManager as any);
    const client = Array.from(clients.values())[0] as any;
    
    const channel = `task:created:${tenantIdA}`;
    (wsManager as any).handleSubscribe(client, { channels: [channel] });

    expect(client.subscriptions.has(channel)).toBe(true);
  });

  it('should broadcast messages only to the correct Redis channel', async () => {
    const tenantId = 'tenant-a';
    const event = 'task:created';
    const payload = { id: 'task-1' };

    await wsManager.broadcast(event, payload, tenantId);

    expect(mockRedis.publish).toHaveBeenCalledWith(
      `${event}:${tenantId}`,
      expect.stringContaining('"tenantId":"tenant-a"')
    );
  });

  it('should reject connections without tenantId (unless SUPER_ADMIN)', async () => {
    const token = jwt.sign({ id: 'user-1', role: 'USER' }, TEST_SECRET);
    const mockWs = createMockWs();
    const mockReq = createMockReq(token);

    await wsManager.handleConnection(mockWs as any, mockReq as any);

    expect(mockWs.close).toHaveBeenCalledWith(4001, 'Unauthorized: Missing Tenant Context');
  });
});
