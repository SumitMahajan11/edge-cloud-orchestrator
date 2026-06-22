import { pino } from 'pino';
import { MetricCleanupJob } from '../metric-cleanup';

vi.mock('../../services/metrics-service.js', () => ({
  nodeMetricRowCount: {
    set: vi.fn(),
  },
}));

describe('MetricCleanupJob', () => {
  let prisma: any;
  let logger: any;
  let job: MetricCleanupJob;
  let mockNodeMetricRowCount: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    const metricsService = await import('../../services/metrics-service.js');
    mockNodeMetricRowCount = metricsService.nodeMetricRowCount;

    prisma = {
      metricRetentionPolicy: {
        findMany: vi.fn(),
      },
      tenant: {
        findMany: vi.fn(),
      },
      nodeMetric: {
        findMany: vi.fn(),
        deleteMany: vi.fn(),
        count: vi.fn(),
      },
      $transaction: vi.fn((cb) => (typeof cb === 'function' ? cb(prisma) : cb)),
    };

    logger = pino({ level: 'silent' });
    job = new MetricCleanupJob(prisma as any, logger, 24 * 60 * 60 * 1000, 30);
  });

  afterEach(() => {
    job.stop();
    vi.useRealTimers();
  });

  it('should clean up metrics for all tenants using default or custom retention policies', async () => {
    // Mock tenants: tenant-1 (uses default 30 days) and tenant-2 (uses custom 7 days)
    prisma.tenant.findMany.mockResolvedValue([
      { id: 'tenant-1', name: 'Tenant One' },
      { id: 'tenant-2', name: 'Tenant Two' },
    ]);

    // Mock custom policy for tenant-2
    prisma.metricRetentionPolicy.findMany.mockResolvedValue([
      { tenantId: 'tenant-2', retentionDays: 7 },
    ]);

    // Mock metrics to delete:
    // First call for tenant-1: returns two metrics (size < 5000, exits loop)
    // Second call for tenant-2: returns one metric (size < 5000, exits loop)
    prisma.nodeMetric.findMany
      .mockResolvedValueOnce([{ id: 'metric-1' }, { id: 'metric-2' }]) // tenant-1 batch 1
      .mockResolvedValueOnce([{ id: 'metric-3' }]); // tenant-2 batch 1

    prisma.nodeMetric.deleteMany.mockResolvedValue({ count: 2 });
    prisma.nodeMetric.count.mockResolvedValue(100); // 100 metrics remaining

    await job.process();

    // Verify tenant findMany was called
    expect(prisma.tenant.findMany).toHaveBeenCalled();

    // Verify metricRetentionPolicy findMany was called
    expect(prisma.metricRetentionPolicy.findMany).toHaveBeenCalled();

    // Verify nodeMetric.findMany was called with correct cutoff dates
    // tenant-1: default 30 days
    expect(prisma.nodeMetric.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          createdAt: expect.objectContaining({
            lt: expect.any(Date),
          }),
        }),
      }),
    );

    // tenant-2: custom 7 days
    expect(prisma.nodeMetric.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-2',
          createdAt: expect.objectContaining({
            lt: expect.any(Date),
          }),
        }),
      }),
    );

    // Verify deleteMany was called for the IDs
    expect(prisma.nodeMetric.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['metric-1', 'metric-2'] } },
    });

    // Verify nodeMetricRowCount gauge was updated with the remaining count
    expect(mockNodeMetricRowCount.set).toHaveBeenCalledWith(100);
  });

  it('should start and run periodic cleanup on interval', async () => {
    prisma.tenant.findMany.mockResolvedValue([]);
    prisma.metricRetentionPolicy.findMany.mockResolvedValue([]);
    prisma.nodeMetric.count.mockResolvedValue(0);

    const processSpy = vi.spyOn(job, 'process');

    job.start();

    // process runs once immediately on start
    expect(processSpy).toHaveBeenCalledTimes(1);

    // Fast forward time by 24 hours
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    // Should have run process again
    expect(processSpy).toHaveBeenCalledTimes(2);
  });
});
