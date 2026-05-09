/**
 * Shared domain types for Edge-Cloud Orchestrator
 */

export type TaskStatus = 'PENDING' | 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'FAILED_PERMANENT' | 'CANCELLED';
export type NodeStatus = 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'MAINTENANCE' | 'STALE' | 'DRAINING';
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
  carbonIntensity?: number;
}

export interface ScoreWeights {
  latency: number;
  cpu: number;
  memory: number;
  cost: number;
  network: number;
  ml: number;
  health: number;
  carbon: number;
}

/**
 * Default scoring weights for multi-objective node selection.
 * Weights sum to 1.0 and prioritize CPU (40%), memory (30%), and latency (30%).
 */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  cpu: 0.40,
  memory: 0.30,
  latency: 0.30,
  cost: 0.0,
  network: 0.0,
  ml: 0.0,
  health: 0.0,
  carbon: 0.0,
} as const;

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
