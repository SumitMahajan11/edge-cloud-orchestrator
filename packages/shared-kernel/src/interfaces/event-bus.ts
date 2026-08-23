import type { DomainEvent } from "../events/domain-events.js";

export interface IEventBus {
  publish<T extends DomainEvent>(
    topic: string,
    event: Omit<T, "eventId" | "timestamp">,
    options?: any,
  ): Promise<void>;
  subscribe<T extends DomainEvent>(
    topic: string,
    groupId: string,
    handler: (event: T) => Promise<void>,
  ): Promise<void>;
}

export const TOPICS = {
  TASK_COMMANDS: "tasks.commands",
  TASK_EVENTS: "tasks.events",
  NODE_COMMANDS: "nodes.commands",
  NODE_EVENTS: "nodes.events",
  METRICS: "metrics.raw",
  METRICS_RAW: "metrics.raw",
  METRICS_AGGREGATED: "metrics.aggregated",
  SCHEDULER_DECISIONS: "scheduler.decisions",
  SYSTEM_ALERTS: "system.alerts",
} as const;
