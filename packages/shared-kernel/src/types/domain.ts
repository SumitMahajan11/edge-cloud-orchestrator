/**
 * Shared domain types for Edge-Cloud Orchestrator
 */

export type TaskStatus = 'PENDING' | 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'FAILED_PERMANENT' | 'CANCELLED';
export type NodeStatus = 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'MAINTENANCE' | 'STALE';
export type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface DomainTask {
  id: string;
  priority: Priority;
  policy: string;
  requirements?: {
    cpu?: number;
    memory?: number;
    gpu?: boolean;
  };
}

export interface DomainNode {
  id: string;
  url: string;
  status: NodeStatus;
  tasksRunning: number;
  cpuUsage?: number;
  memoryUsage?: number;
  latency?: number;
  costPerHour?: number;
  bandwidthInMbps?: number;
  region?: string;
  availabilityZone?: string;
}

export interface ScoreWeights {
  latency: number;
  cpu: number;
  memory: number;
  cost: number;
  network: number;
  ml: number;
  health: number;
}

export interface HealingAction {
  type: 'reschedule-tasks' | 'restart-service' | 'scale-up' | 'scale-down' | 'clear-queue';
  target: string;
  reason: string;
}

export interface Alert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  value?: string;
}

export interface SystemLoad {
  queueDepth: number;
  concurrentTasks: number;
  avgNodeLoad: number;
  memoryUsage: number;
}

export interface BackpressureDecision {
  shouldThrottle: boolean;
  shouldShed: boolean;
  throttleFactor: number;
  reason: string;
}
