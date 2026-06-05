/**
 * Simple alerting service
 * Logs alerts and optionally sends webhooks
 * No PagerDuty - uses logging and optional webhook
 */

import type { Logger } from 'pino';

export interface Alert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  source: string;
  timestamp: Date;
  tenantId: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface AlertingConfig {
  webhookUrl?: string | undefined;
  logAlerts: boolean;
  throttleMs: number;
}

export class AlertingService {
  private logger: Logger;
  private config: AlertingConfig;
  private redis?: any;
  private alertHistory: Alert[] = [];
  private lastAlertTime = new Map<string, number>();

  constructor(
    logger: Logger,
    redisOrConfig?: any,
    config?: Partial<AlertingConfig>,
  ) {
    this.logger = logger;
    if (redisOrConfig && typeof redisOrConfig.multi === 'function') {
      this.redis = redisOrConfig;
      this.config = {
        logAlerts: true,
        throttleMs: 60000, // 1 minute throttle per alert type
        ...config,
      };
    } else {
      this.config = {
        logAlerts: true,
        throttleMs: 60000,
        ...redisOrConfig,
      };
    }
  }

  /**
   * Send an alert
   */
  async alert(
    severity: Alert['severity'],
    title: string,
    message: string,
    source: string,
    tenantId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const alertKey = `${source}:${title}`;
    const now = Date.now();
    const lastTime = this.lastAlertTime.get(alertKey) || 0;

    // Throttle duplicate alerts
    if (now - lastTime < this.config.throttleMs) {
      return;
    }
    this.lastAlertTime.set(alertKey, now);

    const alert: Alert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      severity,
      title,
      message,
      source,
      tenantId,
      timestamp: new Date(),
      metadata,
    };

    // Store in history (keep last 100)
    this.alertHistory.push(alert);
    if (this.alertHistory.length > 100) {
      this.alertHistory.shift();
    }

    // Log the alert
    if (this.config.logAlerts) {
      this.logAlert(alert);
    }

    // Send webhook if configured
    if (this.config.webhookUrl) {
      await this.sendWebhook(alert);
    }
  }

  /**
   * Log alert with appropriate level
   */
  private logAlert(alert: Alert): void {
    const logData = {
      alertId: alert.id,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      source: alert.source,
      metadata: alert.metadata,
    };

    switch (alert.severity) {
      case 'critical':
        this.logger.fatal(
          logData,
          `🚨 [${alert.tenantId}] CRITICAL ALERT: ${alert.title}`,
        );
        break;
      case 'warning':
        this.logger.warn(
          logData,
          `⚠️ [${alert.tenantId}] WARNING: ${alert.title}`,
        );
        break;
      case 'info':
        this.logger.info(
          logData,
          `ℹ️ [${alert.tenantId}] INFO: ${alert.title}`,
        );
        break;
    }
  }

  private isSafeUrl(urlStr: string): boolean {
    try {
      const url = new URL(urlStr);
      const hostname = url.hostname.toLowerCase();
      // Block common local/metadata IPs
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '169.254.169.254' ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('172.16.') ||
        hostname.startsWith('172.17.') ||
        hostname.startsWith('172.18.') ||
        hostname.startsWith('172.19.') ||
        hostname.startsWith('172.2') ||
        hostname.startsWith('172.30.') ||
        hostname.startsWith('172.31.')
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private async recordFailedDelivery(
    url: string,
    reason: string,
    error: string,
  ): Promise<void> {
    this.logger.error({ url, reason, error }, 'Alert webhook delivery failed');
    if (this.redis) {
      await this.redis.lpush(
        'alerts:webhook:failures',
        JSON.stringify({
          url,
          reason,
          error,
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }

  /**
   * Send alert to webhook
   */
  private async sendWebhook(alert: Alert): Promise<void> {
    if (!this.config.webhookUrl) {
      return;
    }

    if (!this.isSafeUrl(this.config.webhookUrl)) {
      await this.recordFailedDelivery(
        this.config.webhookUrl,
        'SSRF_BLOCKED',
        'SSRF blocked',
      );
      return;
    }

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alert),
      });

      if (!response.ok) {
        this.logger.error(
          { status: response.status, alertId: alert.id },
          'Failed to send alert webhook',
        );
        await this.recordFailedDelivery(
          this.config.webhookUrl,
          'HTTP_ERROR',
          `HTTP status ${response.status}`,
        );
      }
    } catch (error) {
      this.logger.error(
        { error: (error as Error).message, alertId: alert.id },
        'Error sending alert webhook',
      );
      await this.recordFailedDelivery(
        this.config.webhookUrl,
        'DELIVERY_ERROR',
        (error as Error).message,
      );
    }
  }

  /**
   * Get alert history
   */
  getAlertHistory(tenantId: string, severity?: Alert['severity']): Alert[] {
    let alerts = this.alertHistory.filter((a) => a.tenantId === tenantId);
    if (severity) {
      alerts = alerts.filter((a) => a.severity === severity);
    }
    return [...alerts];
  }

  getAlerts(tenantId: string): Alert[] {
    return this.getAlertHistory(tenantId);
  }

  acknowledge(id: string, tenantId: string): boolean {
    const alert = this.alertHistory.find(
      (a) => a.id === id && a.tenantId === tenantId,
    );
    if (alert) {
      (alert as any).acknowledgedAt = new Date();
      return true;
    }
    return false;
  }

  /**
   * Clear alert history
   */
  clearHistory(tenantId: string): void {
    this.alertHistory = this.alertHistory.filter(
      (a) => a.tenantId !== tenantId,
    );
  }

  // Convenience methods
  async critical(
    title: string,
    message: string,
    source: string,
    tenantId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.alert('critical', title, message, source, tenantId, metadata);
  }

  async warning(
    title: string,
    message: string,
    source: string,
    tenantId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.alert('warning', title, message, source, tenantId, metadata);
  }

  async info(
    title: string,
    message: string,
    source: string,
    tenantId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.alert('info', title, message, source, tenantId, metadata);
  }
}

// Singleton instance
let alertingService: AlertingService | null = null;

export function initializeAlerting(
  logger: Logger,
  config?: Partial<AlertingConfig>,
): AlertingService {
  if (!alertingService) {
    alertingService = new AlertingService(logger, config);
  }
  return alertingService;
}

export function getAlertingService(): AlertingService | null {
  return alertingService;
}
