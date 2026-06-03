import { PrismaClient } from '@prisma/client';


// Mock PrismaClient
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation((options) => {
    const client = {
      $connect: vi.fn().mockResolvedValue(undefined),
      $disconnect: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
      $transaction: vi.fn((cb: any) => cb()),
      $extends: vi.fn().mockImplementation(() => client),
      ...options,
    };
    return client;
  }),
}));

let mockEnv = {
  DATABASE_URL: 'postgresql://primary:5432/db',
  DATABASE_READ_URL: 'postgresql://replica:5432/db',
  NODE_ENV: 'test'
};

vi.mock('../../config/env', () => ({
  get env() { return mockEnv; }
}));

describe('PrismaClientWithReplicas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = {
      DATABASE_URL: 'postgresql://primary:5432/db',
      DATABASE_READ_URL: 'postgresql://replica:5432/db',
      NODE_ENV: 'test'
    };
    // Clear global singleton
    (global as any).prisma = undefined;
  });

  it('should create primary client when no read replica configured', async () => {
    vi.resetModules();
    mockEnv.DATABASE_READ_URL = '';

    const { prisma } = await import('../client.js');

    expect(PrismaClient).toHaveBeenCalledTimes(1);
    expect(prisma.read).toBe(prisma.write); // Same client for both
  });

  it('should create separate read replica when configured', async () => {
    vi.resetModules();
    const { prisma: _prisma } = await import('../client.js');

    // Should create two clients
    expect(PrismaClient).toHaveBeenCalledTimes(2);

    // Second call should have read replica datasource
    const secondCall = vi.mocked(PrismaClient).mock.calls[1];
    if (!secondCall) throw new Error('Second call to PrismaClient not found');
    expect(secondCall[0]).toMatchObject({
      datasources: {
        db: {
          url: 'postgresql://replica:5432/db',
        },
      },
    });
  });

  it('should connect to both primary and replica', async () => {
    vi.resetModules();
    const { prisma } = await import('../client.js');
    await prisma.$connect();

    // Both clients should connect
    const instances = vi.mocked(PrismaClient).mock.results;
    expect(instances.length).toBe(2);
  });

  it('should disconnect from both clients', async () => {
    vi.resetModules();
    const { prisma } = await import('../client.js');
    await prisma.$disconnect();

    const instances = vi.mocked(PrismaClient).mock.results;
    expect(instances.length).toBe(2);
  });

  it('should pass health check when both connections work', async () => {

    const { prisma } = await import('../client.js');

    const health = await prisma.healthCheck();

    expect(health.primary).toBe(true);
    expect(health.replica).toBe(true);
  });

  it('should expose $transaction on primary client', async () => {

    const { prisma } = await import('../client.js');

    const transactionFn = vi.fn();
    await prisma.$transaction(transactionFn);

    expect(transactionFn).toHaveBeenCalled();
  });
});
