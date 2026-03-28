export interface DomainEvent {
  eventId: string;
  eventType: string;
  aggregateId: string;
  timestamp: Date;
  version: number;
  correlationId?: string;
  causationId?: string;
  metadata?: Record<string, unknown>;
}

// Task Events
export interface TaskCreatedEvent extends DomainEvent {
  eventType: 'TaskCreated';
  taskId: string;
  name: string;
  type: string;
  priority: string;
  target: string;
  region: string;
}

export interface TaskScheduledEvent extends DomainEvent {
  eventType: 'TaskScheduled';
  taskId: string;
  nodeId: string;
  score: number;
  scheduledAt: Date;
}

export interface TaskStartedEvent extends DomainEvent {
  eventType: 'TaskStarted';
  taskId: string;
  nodeId: string;
  startedAt: Date;
}

export interface TaskCompletedEvent extends DomainEvent {
  eventType: 'TaskCompleted';
  taskId: string;
  nodeId: string;
  executionTimeMs: number;
  cost: number;
  output?: Record<string, unknown>;
  completedAt: Date;
}

export interface TaskFailedEvent extends DomainEvent {
  eventType: 'TaskFailed';
  taskId: string;
  nodeId: string;
  error: string;
  retryCount: number;
  willRetry: boolean;
  failedAt: Date;
}

export interface TaskCancelledEvent extends DomainEvent {
  eventType: 'TaskCancelled';
  taskId: string;
  reason: string;
  cancelledAt: Date;
}

// Node Events
export interface NodeRegisteredEvent extends DomainEvent {
  eventType: 'NodeRegistered';
  nodeId: string;
  name: string;
  region: string;
  capabilities: string[];
}

export interface NodeStatusChangedEvent extends DomainEvent {
  eventType: 'NodeStatusChanged';
  nodeId: string;
  previousStatus: string;
  newStatus: string;
  reason?: string;
}

export interface NodeHeartbeatEvent extends DomainEvent {
  eventType: 'NodeHeartbeat';
  nodeId: string;
  metrics: {
    cpuUsage: number;
    memoryUsage: number;
    tasksRunning: number;
  };
  timestamp: Date;
}

export interface NodeFailedEvent extends DomainEvent {
  eventType: 'NodeFailed';
  nodeId: string;
  error: string;
  tasksAffected: string[];
}

// Scheduling Events
export interface SchedulingDecisionEvent extends DomainEvent {
  eventType: 'SchedulingDecision';
  taskId: string;
  nodeId: string;
  score: number;
  scoreComponents: Record<string, number>;
  algorithm: string;
}

// System Events
export interface SystemAlertEvent extends DomainEvent {
  eventType: 'SystemAlert';
  alertType: 'HIGH_LATENCY' | 'NODE_FAILURE' | 'QUEUE_BACKLOG' | 'RESOURCE_EXHAUSTION';
  severity: 'WARNING' | 'CRITICAL';
  message: string;
  details: Record<string, unknown>;
}

export type EdgeCloudEvent =
  | TaskCreatedEvent
  | TaskScheduledEvent
  | TaskStartedEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TaskCancelledEvent
  | NodeRegisteredEvent
  | NodeStatusChangedEvent
  | NodeHeartbeatEvent
  | NodeFailedEvent
  | SchedulingDecisionEvent
  | SystemAlertEvent;
