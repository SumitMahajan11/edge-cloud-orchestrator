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
  private alertHistory: Alert[] = [];
  private lastAlertTime = new Map<string, number>();

  constructor(logger: Logger, config: Partial<AlertingConfig> = {}) {
    this.logger = logger;
    this.config = {
      logAlerts: true,
      throttleMs: 60000, // 1 minute throttle per alert type
      ...config,
    };
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
        this.logger.fatal(logData, `🚨 [${alert.tenantId}] CRITICAL ALERT: ${alert.title}`);
        break;
      case 'warning':
        this.logger.warn(logData, `⚠️ [${alert.tenantId}] WARNING: ${alert.title}`);
        break;
      case 'info':
        this.logger.info(logData, `ℹ️ [${alert.tenantId}] INFO: ${alert.title}`);
        break;
    }
  }

  /**
   * Send alert to webhook
   */
  private async sendWebhook(alert: Alert): Promise<void> {
    if (!this.config.webhookUrl) {
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
      }
    } catch (error) {
      this.logger.error(
        { error: (error as Error).message, alertId: alert.id },
        'Error sending alert webhook',
      );
    }
  }

  /**
   * Get alert history
   */
  getAlertHistory(tenantId: string, severity?: Alert['severity']): Alert[] {
    let alerts = this.alertHistory.filter(a => a.tenantId === tenantId);
    if (severity) {
      alerts = alerts.filter((a) => a.severity === severity);
    }
    return [...alerts];
  }

  /**
   * Clear alert history
   */
  clearHistory(tenantId: string): void {
    this.alertHistory = this.alertHistory.filter(a => a.tenantId !== tenantId);
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
