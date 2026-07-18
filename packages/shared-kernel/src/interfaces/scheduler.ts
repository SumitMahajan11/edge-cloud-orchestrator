import { Priority, SystemLoad, BackpressureDecision } from "../types/domain";

// --- PriorityScheduler ---

export type TaskPriority = Priority;

export interface PriorityTask {
  id: string;
  priority: TaskPriority;
  payload: Record<string, unknown>;
  createdAt: Date;
  deadline?: Date;
  estimatedDuration?: number;
  nodeId?: string;
  userId: string;
  agingBoost: number;
}

export interface ScheduleResult {
  taskId: string;
  priority: TaskPriority;
  scheduledAt: Date;
  estimatedStart: Date;
  position: number;
}

export interface PriorityStats {
  queueDepths: Record<TaskPriority, number>;
  avgWaitTimes: Record<TaskPriority, number>;
  processedCounts: Record<TaskPriority, number>;
  starvedTasks: number;
}

export interface IPriorityScheduler {
  start(): void;
  stop(): void;
  submitTask(task: Omit<PriorityTask, "agingBoost">): Promise<ScheduleResult>;
  getNextBatch(batchSize?: number): Promise<PriorityTask[]>;
  getStats(): Promise<PriorityStats>;
  promoteTask(taskId: string, newPriority: TaskPriority): Promise<boolean>;
  cancelTask(taskId: string): Promise<boolean>;
  removeTasks(taskIds: string[]): Promise<void>;
}

// --- BackpressureController ---

export interface BackpressureConfig {
  maxQueueDepth: number;
  maxConcurrentTasks: number;
  maxTasksPerNode: number;
  loadShedThreshold: number;
  throttleThreshold: number;
  samplingWindowMs: number;
  cooldownMs: number;
}

export interface SystemMetrics extends SystemLoad {
  cpuUsage: number;
  timestamp: Date;
}

export interface ThrottleDecision extends BackpressureDecision {
  metrics: SystemMetrics;
}

export interface IBackpressureController {
  start(): Promise<void>;
  shouldAcceptTask(priority: Priority): Promise<ThrottleDecision>;
  getSystemMetrics(): Promise<SystemMetrics>;
  getConfig(): BackpressureConfig;
  getAdaptiveRateLimit(): Promise<number>;
  canAcceptConnection(): Promise<boolean>;
  refreshConfig(): Promise<void>;
  persistConfig(config: Partial<BackpressureConfig>): Promise<void>;
  getCurrentLoadLevel(): string;
  getLoadHistory(): SystemMetrics[];
  getStats(): {
    currentLevel: string;
    historyLength: number;
    config: BackpressureConfig;
  };
}

// --- GracefulDegradation ---

export type DegradationLevel = "normal" | "degraded" | "minimal" | "critical";

export interface FeatureState {
  name: string;
  enabled: boolean;
  degradationLevel: DegradationLevel;
  fallbackMode: string | null;
}

export interface SystemHealth {
  cpuUsage: number;
  memoryUsage: number;
  latency: number;
  errorRate: number;
  queueDepth: number;
}

export interface IGracefulDegradation {
  start(): void;
  stop(): void;
  isFeatureEnabled(featureName: string): boolean;
  getFallbackMode(featureName: string): string | null;
  getCurrentLevel(): DegradationLevel;
  getFeatureStates(): FeatureState[];
  getLastHealth(): SystemHealth | null;
  executeWithFallback<T>(
    featureName: string,
    primaryFn: () => Promise<T>,
    fallbackFn: () => Promise<T>,
  ): Promise<T>;
  getSchedulingAlgorithm(): "ml" | "weighted" | "round-robin";
  getMetricsStrategy(): "real-time" | "cached" | "minimal";
  setLevel(level: DegradationLevel): void;
}

// --- SchedulerRateLimiter ---

export interface SchedulerRateLimitConfig {
  maxTasksPerNodePerMinute: number;
  maxTasksPerUserPerHour: number;
  maxGlobalTasksPerMinute: number;
  maxPendingTasksPerNode: number;
  maxPendingTasksGlobal: number;
  burstAllowance: number;
}

export interface RateLimitCheck {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
  currentUsage?: any;
}

export interface ISchedulerRateLimiter {
  checkRateLimit(
    taskId: string,
    userId: string,
    nodeId: string,
  ): Promise<RateLimitCheck>;
  recordTaskScheduled(userId: string, nodeId: string): Promise<void>;
  recordTaskCompleted(nodeId: string): Promise<void>;
  getCurrentUsage(userId: string, nodeId: string): Promise<any>;
  getNodeRateLimits(): Promise<Record<string, number>>;
  reset(): Promise<void>;
  getConfig(): SchedulerRateLimitConfig;
  updateConfig(newConfig: Partial<SchedulerRateLimitConfig>): void;
}
