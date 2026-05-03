import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';
import { 
  SYSTEM_INVARIANTS, 
  SAFE_FIXES 
} from '@edgecloud/shared-kernel';
import { 
  consistencyViolationsTotal, 
  consistencyAutoFixesTotal 
} from '../services/metrics-service';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export class ConsistencyCheckerJob {
  private interval: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private s3Client: S3Client;
  private reportBucket: string;
  private lastRunDay: string | null = null;

  constructor(
    private prisma: PrismaClient,
    private logger: Logger,
    private readonly scheduleHour: number = 3, // Default 3 AM
  ) {
    this.reportBucket = process.env.REPORTS_BUCKET || 'edgecloud-reports';
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'minioadmin',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin',
      },
      ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
      forcePathStyle: !!process.env.S3_ENDPOINT,
    });
  }

  /**
   * Start the background job with a 1-minute check interval
   */
  start(): void {
    if (this.interval) return;

    this.logger.info({ scheduleHour: this.scheduleHour }, 'Consistency checker job scheduled');

    this.interval = setInterval(() => {
      const now = new Date();
      const currentDay = now.toISOString().split('T')[0];
      const currentHour = now.getUTCHours();
      
      if (currentHour === this.scheduleHour && this.lastRunDay !== currentDay) {
        this.lastRunDay = currentDay;
        this.logger.info({ hour: currentHour, day: currentDay }, 'Triggering scheduled consistency check');
        this.run().catch((err) => {
          this.logger.error({ err }, 'Error in ConsistencyCheckerJob run');
        });
      }
    }, 60000); // Check every minute
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      this.logger.info('Consistency checker job stopped');
    }
  }

  /**
   * Run the consistency check suite
   */
  async run(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const startTime = Date.now();
    const results: any = {
      timestamp: new Date().toISOString(),
      invariants: [],
      autoFixes: [],
      summary: {
        totalViolations: 0,
        fixedCount: 0,
        durationMs: 0
      }
    };

    this.logger.info('Starting system consistency check...');

    try {
      // 1. Run Invariant Checks
      for (const [key, invariant] of Object.entries(SYSTEM_INVARIANTS)) {
        try {
          const violations = await this.prisma.$queryRawUnsafe(invariant.query);
          const violationCount = Array.isArray(violations) ? violations.length : 0;
          
          results.invariants.push({
            name: invariant.name,
            violated: violationCount > 0,
            violationCount,
            details: violations
          });

          if (violationCount > 0) {
            this.logger.warn({ invariant: invariant.name, count: violationCount }, 'Consistency violation detected');
            consistencyViolationsTotal.labels(invariant.name).inc(violationCount);
            
            // Log to audit log
            await this.prisma.auditLog.create({
              data: {
                action: 'CONSISTENCY_VIOLATION',
                entityType: 'System',
                details: { 
                  invariant: invariant.name, 
                  count: violationCount,
                  description: invariant.description
                } as any,
                tenantId: 'SYSTEM' // Global system tenant
              }
            });
          }
          results.summary.totalViolations += violationCount;
        } catch (err) {
          this.logger.error({ err, invariant: invariant.name }, 'Failed to run invariant check');
        }
      }

      // 2. Run Safe Fixes
      for (const [key, fix] of Object.entries(SAFE_FIXES)) {
        try {
          const toFix: any[] = await this.prisma.$queryRawUnsafe(fix.query);
          if (toFix.length > 0) {
            const ids = toFix.map(item => item.id);
            this.logger.info({ fix: fix.name, count: ids.length }, 'Applying auto-fix');
            
            try {
              await fix.fix(this.prisma, ids);
              results.autoFixes.push({
                name: fix.name,
                fixedCount: ids.length,
                status: 'SUCCESS'
              });
              consistencyAutoFixesTotal.labels(fix.name, 'success').inc(ids.length);
              results.summary.fixedCount += ids.length;
            } catch (fixErr) {
              this.logger.error({ err: fixErr, fix: fix.name }, 'Failed to apply auto-fix');
              results.autoFixes.push({
                name: fix.name,
                status: 'FAILED',
                error: fixErr instanceof Error ? fixErr.message : String(fixErr)
              });
              consistencyAutoFixesTotal.labels(fix.name, 'failure').inc(1);
            }
          }
        } catch (err) {
          this.logger.error({ err, fix: fix.name }, 'Failed to run auto-fix check');
        }
      }

      results.summary.durationMs = Date.now() - startTime;

      // 3. Upload Report to S3
      await this.uploadReport(results);

      this.logger.info(results.summary, 'Consistency check completed');

    } catch (error) {
      this.logger.error({ error }, 'Fatal error during consistency check');
    } finally {
      this.isProcessing = false;
    }
  }

  private async uploadReport(results: any): Promise<void> {
    const dateStr = new Date().toISOString().split('T')[0];
    const key = `consistency-reports/report-${dateStr}.json`;
    
    try {
      const command = new PutObjectCommand({
        Bucket: this.reportBucket,
        Key: key,
        Body: JSON.stringify(results, null, 2),
        ContentType: 'application/json'
      });

      await this.s3Client.send(command);
      this.logger.info({ key }, 'Consistency report uploaded to S3');
    } catch (err) {
      this.logger.error({ err }, 'Failed to upload consistency report to S3');
    }
  }
}
