import { WebSocketManager } from '../websocket-manager';
import jwt from 'jsonwebtoken';

const { TEST_SECRET } = vi.hoisted(() => ({
  TEST_SECRET: 'a'.repeat(32),
}));

vi.mock('../../config/env', () => ({
  env: {
    JWT_SECRET: TEST_SECRET,
    NODE_ENV: 'test',
  },
}));

describe('WebSocketManager Authentication', () => {
  let wsManager: WebSocketManager;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    wsManager = new WebSocketManager(mockLogger);
  });

  it('should accept connection with valid JWT in query parameter', async () => {
    const token = jwt.sign(
      { id: 'user-1', email: 'test@example.com', role: 'ADMIN' },
      TEST_SECRET,
    );
    const mockWs = {
      on: vi.fn(),
      send: vi.fn(),
      readyState: 1, // OPEN
      close: vi.fn(),
    } as any;

    const mockReq = {
      url: `/ws?token=${token}`,
      headers: { host: 'localhost' },
    } as any;

    wsManager.handleConnection(mockWs, mockReq);

    expect(mockWs.close).not.toHaveBeenCalled();
    expect(mockWs.send).toHaveBeenCalledWith(
      expect.stringContaining('connected'),
    );

    // Check if client is stored and authenticated
    const clients = (wsManager as any).clients;
    expect(clients.size).toBe(1);
    const client = Array.from(clients.values())[0] as any;
    expect(client.isAuthenticated).toBe(true);
    expect(client.userId).toBe('user-1');
  });

  it('should accept connection with valid JWT in Authorization header', async () => {
    const token = jwt.sign(
      { id: 'user-2', email: 'test@example.com', role: 'ADMIN' },
      TEST_SECRET,
    );
    const mockWs = {
      on: vi.fn(),
      send: vi.fn(),
      readyState: 1, // OPEN
      close: vi.fn(),
    } as any;

    const mockReq = {
      url: '/ws',
      headers: {
        host: 'localhost',
        authorization: `Bearer ${token}`,
      },
    } as any;

    wsManager.handleConnection(mockWs, mockReq);

    expect(mockWs.close).not.toHaveBeenCalled();
    expect(mockWs.send).toHaveBeenCalledWith(
      expect.stringContaining('connected'),
    );

    const clients = (wsManager as any).clients;
    const client = Array.from(clients.values())[0] as any;
    expect(client.userId).toBe('user-2');
  });

  it('should reject connection with no token', async () => {
    const mockWs = {
      on: vi.fn(),
      send: vi.fn(),
      readyState: 1,
      close: vi.fn(),
    } as any;

    const mockReq = {
      url: '/ws',
      headers: { host: 'localhost' },
    } as any;

    wsManager.handleConnection(mockWs, mockReq);

    expect(mockWs.close).toHaveBeenCalledWith(4001, 'Unauthorized');
    expect((wsManager as any).clients.size).toBe(0);
  });

  it('should reject connection with invalid token', async () => {
    const mockWs = {
      on: vi.fn(),
      send: vi.fn(),
      readyState: 1,
      close: vi.fn(),
    } as any;

    const mockReq = {
      url: '/ws?token=invalid-token',
      headers: { host: 'localhost' },
    } as any;

    wsManager.handleConnection(mockWs, mockReq);

    expect(mockWs.close).toHaveBeenCalledWith(4001, 'Unauthorized');
    expect((wsManager as any).clients.size).toBe(0);
  });
});
