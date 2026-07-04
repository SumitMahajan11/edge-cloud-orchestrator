import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';
import { nodeMetricRowCount } from '../services/metrics-service.js';

export class MetricCleanupJob {
  private interval: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private prisma: PrismaClient,
    private logger: Logger,
    private readonly intervalMs: number = 24 * 60 * 60 * 1000, // 24 hours
    private readonly defaultRetentionDays: number = 30, // 30 days default
  ) {}

  /**
   * Start the background job
   */
  start(): void {
    if (this.interval) {
      return;
    }

    this.interval = setInterval(() => {
      this.process().catch((err) => {
        this.logger.error({ err }, 'Unhandled error in MetricCleanupJob');
      });
    }, this.intervalMs);

    this.logger.info(
      { intervalMs: this.intervalMs, defaultRetentionDays: this.defaultRetentionDays },
      'Metric cleanup job started',
    );

    // Run once immediately on start (in background) to clean up and initialize the prometheus gauge
    this.process().catch((err) => {
      this.logger.error({ err }, 'Unhandled error in initial run of MetricCleanupJob');
    });
  }

  /**
   * Stop the background job
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      this.logger.info('Metric cleanup job stopped');
    }
  }

  /**
   * Process cleanup
   */
  async process(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    this.logger.info('Starting nightly metric cleanup process');

    try {
      // 1. Fetch custom retention policies
      const policies = this.prisma.metricRetentionPolicy
        ? await this.prisma.metricRetentionPolicy.findMany()
        : [];
      const policyMap = new Map<string, number>();
      for (const policy of policies) {
        policyMap.set(policy.tenantId, policy.retentionDays);
      }

      // 2. Fetch all tenants
      const tenants = await this.prisma.tenant.findMany({
        select: { id: true, name: true },
      });

      let totalDeleted = 0;

      // 3. Perform cleanup for each tenant
      for (const tenant of tenants) {
        const retentionDays = policyMap.get(tenant.id) ?? this.defaultRetentionDays;
        const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

        this.logger.info(
          { tenantId: tenant.id, tenantName: tenant.name, retentionDays, cutoffDate },
          'Cleaning up metrics for tenant',
        );

        let tenantDeleted = 0;
        let batchDeleted = 0;

        do {
          // Find up to 5000 records to delete
          const metricsToDelete = await this.prisma.nodeMetric.findMany({
            where: {
              tenantId: tenant.id,
              createdAt: { lt: cutoffDate },
            },
            select: { id: true },
            take: 5000,
          });

          if (metricsToDelete.length === 0) {
            break;
          }

          const ids = metricsToDelete.map((m) => m.id);

          // Delete them in a transaction to ensure stability and release locks
          const result = await this.prisma.$transaction(async (tx) => {
            return await tx.nodeMetric.deleteMany({
              where: {
                id: { in: ids },
              },
            });
          });

          batchDeleted = result.count;
          tenantDeleted += batchDeleted;
          totalDeleted += batchDeleted;

          this.logger.debug(
            { tenantId: tenant.id, batchCount: batchDeleted },
            'Deleted a batch of old metrics',
          );
        } while (batchDeleted === 5000);

        if (tenantDeleted > 0) {
          this.logger.info(
            { tenantId: tenant.id, totalDeleted: tenantDeleted },
            'Completed metric cleanup for tenant',
          );
        }
      }

      // 4. Update the Prometheus row count gauge
      const currentCount = await this.prisma.nodeMetric.count();
      nodeMetricRowCount.set(currentCount);

      this.logger.info(
        { totalDeleted, remainingCount: currentCount },
        'Metric cleanup process completed successfully',
      );
    } catch (error) {
      this.logger.error({ error }, 'Error during metric cleanup process');
    } finally {
      this.isProcessing = false;
    }
  }
}
