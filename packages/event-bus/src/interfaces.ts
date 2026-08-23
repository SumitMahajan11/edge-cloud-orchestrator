import type { DomainEvent } from "@edgecloud/shared-kernel";

export interface TaskCreatedEvent extends DomainEvent {
  eventType: "TaskCreated";
  taskId: string;
  name: string;
  type: string;
  priority: number;
  target: string;
  region: string;
}

export interface TaskScheduledEvent extends DomainEvent {
  eventType: "TaskScheduled";
  taskId: string;
  nodeId: string;
  score: number;
  scheduledAt: Date;
}

export interface TaskCompletedEvent extends DomainEvent {
  eventType: "TaskCompleted";
  taskId: string;
  nodeId: string;
  executionTimeMs: number;
  cost: number;
  output?: Record<string, unknown>;
  completedAt: Date;
}

export interface TaskFailedEvent extends DomainEvent {
  eventType: "TaskFailed";
  taskId: string;
  nodeId: string;
  error: string;
  retryCount: number;
  willRetry: boolean;
  failedAt: Date;
}

export interface NodeHeartbeatEvent extends DomainEvent {
  eventType: "NodeHeartbeat";
  nodeId: string;
  metrics: {
    cpuUsage: number;
    memoryUsage: number;
    tasksRunning: number;
  };
}

export interface AlertFiredEvent extends DomainEvent {
  eventType: "AlertFired";
  alertId: string;
  severity: "info" | "warning" | "critical";
  message: string;
  metadata?: Record<string, unknown>;
}
