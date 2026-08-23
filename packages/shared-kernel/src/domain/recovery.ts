import type { Alert, HealingAction } from "../types/domain.js";

export interface RecoveryConfig {
  cooldownMs: number;
  maxRetries: number;
  backoffFactor: number;
}

export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  cooldownMs: 60000,
  maxRetries: 3,
  backoffFactor: 2,
};

export function determineHealingAction(alert: Alert): HealingAction | null {
  const alertName = alert.labels.alertname || "";
  const target =
    alert.labels.instance ||
    alert.labels.service ||
    alert.labels.node ||
    "unknown";

  const alertMap: Record<string, HealingAction["type"]> = {
    NodeDown: "reschedule-tasks",
    NodeUnreachable: "reschedule-tasks",
    HighNodeLoad: "scale-up",
    ServiceCrashLooping: "restart-service",
    ServiceNotReady: "restart-service",
    HighMemoryUsage: "scale-up",
    KafkaConsumerLag: "scale-up",
    QueueBacklog: "scale-up",
    DeadlockDetected: "restart-service",
  };

  const type = alertMap[alertName];
  if (!type) return null;

  return {
    type,
    target,
    reason:
      alert.annotations.summary ||
      alert.annotations.description ||
      "Alert triggered",
  };
}

export function shouldRetry(attempt: number, config: RecoveryConfig): boolean {
  return attempt < config.maxRetries;
}

export function calculateRetryDelay(
  attempt: number,
  config: RecoveryConfig,
): number {
  return config.cooldownMs * Math.pow(config.backoffFactor, attempt);
}

export function processBatchAlerts(alerts: Alert[]): HealingAction[] {
  const actions: HealingAction[] = [];
  const seenTargets = new Set<string>();

  for (const alert of alerts) {
    const action = determineHealingAction(alert);
    if (action && !seenTargets.has(`${action.type}:${action.target}`)) {
      actions.push(action);
      seenTargets.add(`${action.type}:${action.target}`);
    }
  }

  return actions;
}
