import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import crypto from 'crypto';
import { Logger } from 'pino';

export class WebhookRetryJob {
  private interval: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private prisma: PrismaClient,
    private logger: Logger,
    private readonly intervalMs: number = 60000,
    private readonly maxRetries: number = 5
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
        this.logger.error({ err }, 'Unhandled error in WebhookRetryJob');
      });
    }, this.intervalMs);

    this.logger.info({ intervalMs: this.intervalMs }, 'Webhook retry job started');
  }

  /**
   * Stop the background job
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      this.logger.info('Webhook retry job stopped');
    }
  }

  /**
   * Process pending retries
   */
  async process(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    const now = new Date();

    try {
      const failedDeliveries = await this.prisma.webhookDelivery.findMany({
        where: {
          status: 'FAILED',
          retryCount: { lt: this.maxRetries },
          OR: [
            { nextRetryAt: { lte: now } },
            { nextRetryAt: null }
          ]
        },
        include: {
          webhook: true
        },
        take: 50 // Process in batches
      });

      if (failedDeliveries.length > 0) {
        this.logger.info({ count: failedDeliveries.length }, 'Processing failed webhook deliveries');
      }

      for (const delivery of failedDeliveries) {
        await this.attemptDelivery(delivery);
      }
    } catch (error) {
      this.logger.error({ error }, 'Error querying failed webhook deliveries');
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Attempt a single delivery
   */
  private async attemptDelivery(delivery: any): Promise<void> {
    const { webhook, payload, event } = delivery;

    if (!webhook || !webhook.enabled) {
      this.logger.warn({ deliveryId: delivery.id, webhookId: delivery.webhookId }, 'Webhook disabled or missing, skipping retry');
      return;
    }

    const payloadString = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', webhook.secret || '')
      .update(payloadString)
      .digest('hex');

    // SECURITY: SSRF Protection
    const { SSRFProtection } = await import('../utils/ssrf-protection.js');
    const isSafe = await SSRFProtection.isSafeUrl(webhook.url);
    if (!isSafe) {
      this.logger.error({ deliveryId: delivery.id, url: webhook.url }, 'Blocked unsafe webhook URL (SSRF Protection)');
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          response: 'Security Error: Unsafe destination URL blocked.'
        }
      });
      return;
    }

    try {
      const response = await axios.post(webhook.url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': event,
          'X-Webhook-Delivery-Id': delivery.id,
          'User-Agent': 'EdgeCloud-Webhook-Manager/2.0'
        },
        timeout: 10000 // 10s timeout
      });

      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'DELIVERED',
          statusCode: response.status,
          response: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
          deliveredAt: new Date()
        }
      });

      this.logger.info({ deliveryId: delivery.id, webhookId: webhook.id }, 'Webhook delivery successful on retry');
    } catch (error: any) {
      const nextRetryCount = delivery.retryCount + 1;
      const statusCode = error.response?.status;
      const responseData = error.response?.data;
      const errorMessage = typeof responseData === 'string' ? responseData : JSON.stringify(responseData) || error.message;

      if (nextRetryCount >= this.maxRetries) {
        // Max retries exhausted
        await this.prisma.$transaction([
          this.prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'DEAD_LETTERED',
              retryCount: nextRetryCount,
              statusCode,
              response: errorMessage
            }
          }),
          this.prisma.auditLog.create({
            data: {
              action: 'WEBHOOK_EXHAUSTED',
              entityType: 'WebhookDelivery',
              entityId: delivery.id,
              tenantId: delivery.tenantId,
              details: {
                webhookId: delivery.webhookId,
                event: delivery.event,
                finalError: errorMessage,
                finalStatus: statusCode,
                attempts: nextRetryCount
              }
            }
          })
        ]);

        this.logger.error({ deliveryId: delivery.id, webhookId: webhook.id }, 'Webhook delivery exhausted all retries');
      } else {
        // Calculate exponential backoff: 2^retryCount * 60s, capped at 1 hour
        const backoffMinutes = Math.pow(2, nextRetryCount);
        const backoffMs = Math.min(backoffMinutes * 60000, 3600000);
        const nextRetryAt = new Date(Date.now() + backoffMs);

        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            retryCount: nextRetryCount,
            nextRetryAt,
            statusCode,
            response: errorMessage
          }
        });

        this.logger.warn(
          { deliveryId: delivery.id, nextRetryAt, retryCount: nextRetryCount },
          'Webhook delivery failed, scheduled next retry'
        );
      }
    }
  }
}
