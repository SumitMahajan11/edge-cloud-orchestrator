import nock from 'nock';
import { pino } from 'pino';
import { WebhookRetryJob } from '../webhook-retry';


describe('WebhookRetryJob', () => {
  let prisma: any;
  let logger: any;
  let job: WebhookRetryJob;

  beforeEach(() => {
    prisma = {
      webhookDelivery: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn((cb) => (typeof cb === 'function' ? cb(prisma) : cb)),
    };
    logger = pino({ level: 'silent' });
    job = new WebhookRetryJob(prisma as any, logger, 60000, 5);
    
    // Enable system time mocking
    vi.useFakeTimers();
  });

  afterEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('should successfully retry a failed delivery', async () => {
    const delivery = {
      id: 'del-1',
      webhookId: 'web-1',
      tenantId: 'tenant-1',
      event: 'task.completed',
      payload: { foo: 'bar' },
      retryCount: 1,
      webhook: {
        url: 'https://example.com/webhook',
        secret: 'secret-key',
        enabled: true,
      },
    };

    prisma.webhookDelivery.findMany.mockResolvedValue([delivery]);
    
    const scope = nock('https://example.com')
      .post('/webhook', (body) => body.foo === 'bar')
      .reply(200, { success: true });

    await job.process();

    expect(scope.isDone()).toBe(true);
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'del-1' },
      data: expect.objectContaining({
        status: 'DELIVERED',
        statusCode: 200,
      }),
    }));
  });

  it('should increment retry count and calculate exponential backoff on failure', async () => {
    const delivery = {
      id: 'del-2',
      webhookId: 'web-1',
      tenantId: 'tenant-1',
      event: 'task.completed',
      payload: { foo: 'bar' },
      retryCount: 1,
      webhook: {
        url: 'https://example.com/webhook',
        secret: 'secret-key',
        enabled: true,
      },
    };

    prisma.webhookDelivery.findMany.mockResolvedValue([delivery]);
    
    nock('https://example.com')
      .post('/webhook')
      .reply(500, 'Internal Server Error');

    const now = new Date('2024-01-01T12:00:00Z');
    vi.setSystemTime(now);

    await job.process();

    // nextRetryCount = 2
    // backoffMinutes = 2^2 = 4
    // backoffMs = 4 * 60000 = 240,000ms
    const expectedNextRetryAt = new Date(now.getTime() + 240000);

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'del-2' },
      data: expect.objectContaining({
        retryCount: 2,
        nextRetryAt: expectedNextRetryAt,
      }),
    }));
  });

  it('should mark as DEAD_LETTERED and create audit log after max retries', async () => {
    const delivery = {
      id: 'del-3',
      webhookId: 'web-1',
      tenantId: 'tenant-1',
      event: 'task.completed',
      payload: { foo: 'bar' },
      retryCount: 4, // Next attempt will be the 5th (maxRetries)
      webhook: {
        url: 'https://example.com/webhook',
        secret: 'secret-key',
        enabled: true,
      },
    };

    prisma.webhookDelivery.findMany.mockResolvedValue([delivery]);
    
    nock('https://example.com')
      .post('/webhook')
      .reply(404, 'Not Found');

    await job.process();

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'del-3' },
      data: expect.objectContaining({
        status: 'DEAD_LETTERED',
        retryCount: 5,
      }),
    }));

    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'WEBHOOK_EXHAUSTED',
        entityId: 'del-3',
        tenantId: 'tenant-1'
      }),
    }));
  });

  it('should respect the batch size (take)', async () => {
    prisma.webhookDelivery.findMany.mockResolvedValue([]);
    
    await job.process();

    expect(prisma.webhookDelivery.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 50
    }));
  });

  it('should skip retries for disabled webhooks', async () => {
    const delivery = {
      id: 'del-4',
      webhookId: 'web-1',
      webhook: {
        enabled: false,
        url: 'https://example.com/webhook'
      }
    };

    prisma.webhookDelivery.findMany.mockResolvedValue([delivery]);
    
    const scope = nock('https://example.com')
      .post('/webhook')
      .reply(200);

    await job.process();

    expect(scope.isDone()).toBe(false);
    expect(prisma.webhookDelivery.update).not.toHaveBeenCalled();
  });
});
