import type { TaskStatus, Priority as TaskPriority } from '../types/domain.js';

export type TaskType = 
  | 'IMAGE_CLASSIFICATION'
  | 'DATA_AGGREGATION'
  | 'MODEL_INFERENCE'
  | 'SENSOR_FUSION'
  | 'VIDEO_PROCESSING'
  | 'LOG_ANALYSIS'
  | 'ANOMALY_DETECTION'
  | 'CUSTOM';

export type ExecutionTarget = 'EDGE' | 'CLOUD';

export interface Task {
  id: string;
  name: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  target: ExecutionTarget;
  nodeId?: string;
  specs?: {
    cpuCores: number;
    memoryGB: number;
  };
  policy: string;
  reason: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  maxRetries: number;
  submittedAt: Date;
  scheduledAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  cancelledAt?: Date;
  retryCount: number;
  executionTimeMs?: number;
  cost?: number;
  region: string;
  runtime: 'NATIVE' | 'DOCKER' | 'WASM';
  affinity?: string;
  traceId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTaskCommand {
  name: string;
  type: TaskType;
  priority: TaskPriority;
  target?: ExecutionTarget;
  nodeId?: string;
  specs?: {
    cpuCores: number;
    memoryGB: number;
  };
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  maxRetries?: number;
  runtime?: 'NATIVE' | 'DOCKER' | 'WASM';
  affinity?: string;
  traceId?: string;
}

export interface TaskScore {
  taskId: string;
  nodeId: string;
  score: number;
  components: {
    latency: number;
    cpu: number;
    memory: number;
    cost: number;
    network: number;
    mlPrediction: number;
  };
}
