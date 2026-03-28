export type TaskType = 
  | 'IMAGE_CLASSIFICATION'
  | 'DATA_AGGREGATION'
  | 'MODEL_INFERENCE'
  | 'SENSOR_FUSION'
  | 'VIDEO_PROCESSING'
  | 'LOG_ANALYSIS'
  | 'ANOMALY_DETECTION'
  | 'CUSTOM';

export type TaskStatus = 
  | 'PENDING'
  | 'SCHEDULED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type TaskPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ExecutionTarget = 'EDGE' | 'CLOUD';

export interface Task {
  id: string;
  name: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  target: ExecutionTarget;
  nodeId?: string;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTaskCommand {
  name: string;
  type: TaskType;
  priority: TaskPriority;
  target?: ExecutionTarget;
  nodeId?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  maxRetries?: number;
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
