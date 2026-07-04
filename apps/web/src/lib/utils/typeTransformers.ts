// Type transformers to convert between frontend and backend types

import type {
  EdgeNode,
  LogEntry,
  NodeStatus,
  SystemMetrics,
  Task,
  TaskPriority,
  TaskStatus,
  TaskType,
  RuntimeType,
} from "../../types";

// Backend uses SCREAMING_SNAKE_CASE, frontend uses Title Case
const TASK_TYPE_MAP: Record<string, TaskType> = {
  IMAGE_CLASSIFICATION: "Image Classification",
  DATA_AGGREGATION: "Data Aggregation",
  MODEL_INFERENCE: "Model Inference",
  SENSOR_FUSION: "Sensor Fusion",
  VIDEO_PROCESSING: "Video Processing",
  LOG_ANALYSIS: "Log Analysis",
  ANOMALY_DETECTION: "Anomaly Detection",
  DATA_PROCESSING: "Data Processing",
  ETL_PIPELINE: "ETL Pipeline",
  ML_TRAINING: "Machine Learning Training",
  NLP: "Natural Language Processing",
  COMPUTER_VISION: "Computer Vision",
  SPEECH_RECOGNITION: "Speech Recognition",
  RECOMMENDATION_ENGINE: "Recommendation Engine",
  FRAUD_DETECTION: "Fraud Detection",
  IOT_DATA_INGESTION: "IoT Data Ingestion",
  REALTIME_ANALYTICS: "Real-time Analytics",
  BATCH_PROCESSING: "Batch Processing",
  CONTAINER_BUILD: "Container Build",
  CICD_PIPELINE: "CI/CD Pipeline",
  INFERENCE: "Model Inference",
  PREPROCESSING: "Data Aggregation",
  POSTPROCESSING: "Data Aggregation",
};

const TASK_TYPE_REVERSE_MAP: Record<string, string> = {
  "Image Classification": "IMAGE_CLASSIFICATION",
  "Data Aggregation": "DATA_AGGREGATION",
  "Model Inference": "MODEL_INFERENCE",
  "Sensor Fusion": "SENSOR_FUSION",
  "Video Processing": "VIDEO_PROCESSING",
  "Log Analysis": "LOG_ANALYSIS",
  "Anomaly Detection": "ANOMALY_DETECTION",
  "Data Processing": "DATA_PROCESSING",
  "ETL Pipeline": "ETL_PIPELINE",
  "Machine Learning Training": "ML_TRAINING",
  "Natural Language Processing": "NLP",
  "Computer Vision": "COMPUTER_VISION",
  "Speech Recognition": "SPEECH_RECOGNITION",
  "Recommendation Engine": "RECOMMENDATION_ENGINE",
  "Fraud Detection": "FRAUD_DETECTION",
  "IoT Data Ingestion": "IOT_DATA_INGESTION",
  "Real-time Analytics": "REALTIME_ANALYTICS",
  "Batch Processing": "BATCH_PROCESSING",
  "Container Build": "CONTAINER_BUILD",
  "CI/CD Pipeline": "CICD_PIPELINE",
};

const PRIORITY_MAP: Record<string, TaskPriority> = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
};

const PRIORITY_REVERSE_MAP: Record<TaskPriority, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
};

const STATUS_MAP: Record<string, TaskStatus> = {
  PENDING: "pending",
  QUEUED: "pending",
  SCHEDULED: "scheduled",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  TIMEOUT: "failed",
  RETRYING: "pending",
  // Also handle lowercase (from mock)
  pending: "pending",
  scheduled: "scheduled",
  running: "running",
  completed: "completed",
  failed: "failed",
};

// STATUS_REVERSE_MAP is used by transformTaskToApi via TASK_TYPE_REVERSE_MAP pattern
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const STATUS_REVERSE_MAP: Record<TaskStatus, string> = {
  pending: "PENDING",
  scheduled: "SCHEDULED",
  running: "RUNNING",
  completed: "COMPLETED",
  failed: "FAILED",
};

// Prevent tree-shaking of STATUS_REVERSE_MAP
void STATUS_REVERSE_MAP;

const NODE_STATUS_MAP: Record<string, NodeStatus> = {
  ONLINE: "online",
  OFFLINE: "offline",
  DEGRADED: "degraded",
  ERROR: "offline",
  // Also handle lowercase (from mock)
  online: "online",
  offline: "offline",
  degraded: "degraded",
};

const NODE_STATUS_REVERSE_MAP: Record<NodeStatus, string> = {
  online: "ONLINE",
  offline: "OFFLINE",
  degraded: "DEGRADED",
};

// Transform node from API to frontend format
export function transformNodeFromApi(apiNode: any): EdgeNode {
  return {
    id: apiNode.id,
    name: apiNode.name,
    location: apiNode.location,
    region: apiNode.region,
    status: NODE_STATUS_MAP[apiNode.status] || "offline",
    cpu: apiNode.cpuUsage || 0,
    memory: apiNode.memoryUsage || 0,
    storage: apiNode.storageUsage || 0,
    latency: apiNode.latency || 0,
    uptime: 99.9, // Calculate from metrics if available
    tasksRunning: apiNode.tasksRunning || 0,
    maxTasks: apiNode.maxTasks || 10,
    lastHeartbeat: apiNode.lastHeartbeat
      ? new Date(apiNode.lastHeartbeat)
      : new Date(),
    ip: apiNode.ipAddress || "0.0.0.0",
    url: apiNode.url || "",
    costPerHour: apiNode.costPerHour || 0.02,
    bandwidthIn: apiNode.bandwidthIn || 50,
    bandwidthOut: apiNode.bandwidthOut || 50,
    healthHistory: [],
    isMaintenanceMode: apiNode.isMaintenanceMode || false,
  };
}

// Transform node from frontend to API format
export function transformNodeToApi(node: Partial<EdgeNode>): any {
  return {
    name: node.name,
    location: node.location,
    region: node.region,
    ipAddress: node.ip || "0.0.0.0",
    port: 4001,
    cpuCores: node.cpu || 4,
    memoryGB: node.memory ? Math.ceil(node.memory / 1024) : 16,
    storageGB: node.storage || 100,
    ...(node.status && {
      status: NODE_STATUS_REVERSE_MAP[node.status as NodeStatus],
    }),
    maxTasks: node.maxTasks || 10,
    costPerHour: node.costPerHour || 0.05,
    isMaintenanceMode: node.isMaintenanceMode || false,
  };
}

// Transform task from API to frontend format
export function transformTaskFromApi(apiTask: any): Task {
  return {
    id: apiTask.id,
    name: apiTask.name,
    type: TASK_TYPE_MAP[apiTask.type] || "Model Inference",
    priority: PRIORITY_MAP[apiTask.priority] || "medium",
    status: STATUS_MAP[apiTask.status] || "pending",
    target: apiTask.nodeId ? "edge" : "cloud",
    nodeId: apiTask.nodeId,
    submittedAt: apiTask.submittedAt
      ? new Date(apiTask.submittedAt)
      : new Date(),
    startedAt: apiTask.startedAt ? new Date(apiTask.startedAt) : undefined,
    completedAt: apiTask.completedAt
      ? new Date(apiTask.completedAt)
      : undefined,
    duration: apiTask.executionTimeMs || 0,
    cost: apiTask.cost || 0,
    latencyMs: apiTask.latencyMs || 0,
    reason: apiTask.reason || "",
    runtime: (apiTask.runtime || "native") as RuntimeType,
    retryCount: apiTask.retryCount || 0,
    maxRetries: apiTask.maxRetries || 3,
    metadata: apiTask.metadata,
  };
}

// Transform task from frontend to API format
export function transformTaskToApi(task: Partial<Task>): any {
  const mappedType = task.type
    ? TASK_TYPE_REVERSE_MAP[task.type] ||
      task.type.toUpperCase().replace(/[\s\-\/]/g, "_")
    : "MODEL_INFERENCE";
  return {
    name: task.name,
    type: mappedType,
    priority: task.priority
      ? PRIORITY_REVERSE_MAP[task.priority as TaskPriority]
      : "MEDIUM",
    target: "EDGE",
    nodeId: task.nodeId,
    maxRetries: task.maxRetries || 3,
  };
}

// Transform log from API to frontend format
export function transformLogFromApi(apiLog: any): LogEntry {
  return {
    id: apiLog.id,
    timestamp: new Date(apiLog.timestamp || apiLog.createdAt),
    level: (apiLog.level?.toLowerCase() || "info") as LogEntry["level"],
    source: apiLog.source || "System",
    message: apiLog.message,
    metadata: apiLog.metadata,
    taskId: apiLog.taskId ?? undefined,
    nodeId: apiLog.nodeId ?? (apiLog.source === "node" ? apiLog.entityId : undefined),
  };
}

// Transform metrics from API to frontend format
export function transformMetricsFromApi(apiMetrics: any): SystemMetrics {
  return {
    totalNodes: apiMetrics.totalNodes || 0,
    onlineNodes: apiMetrics.onlineNodes || 0,
    offlineNodes: apiMetrics.offlineNodes || 0,
    degradedNodes: apiMetrics.degradedNodes || 0,
    totalTasks: apiMetrics.totalTasks || 0,
    runningTasks: apiMetrics.runningTasks || 0,
    pendingTasks: apiMetrics.pendingTasks || 0,
    completedTasks: apiMetrics.completedTasks || 0,
    failedTasks: apiMetrics.failedTasks || 0,
    avgLatency: apiMetrics.avgLatency || 0,
    totalCost: apiMetrics.totalCost || 0,
    edgeUtilization: apiMetrics.edgeUtilization || 0,
    cloudUtilization: apiMetrics.cloudUtilization || 0,
    throughput: apiMetrics.throughput || 0,
    cpuHistory: apiMetrics.cpuHistory || [],
    taskDistribution: apiMetrics.taskDistribution || { edge: 0, cloud: 0 },
    healthScore: apiMetrics.healthScore || 100,
    completionRate: apiMetrics.completionRate || 0,
    costOverTime: apiMetrics.costOverTime || [],
  };
}

// Batch transform helpers
export function transformNodesFromApi(apiNodes: any[]): EdgeNode[] {
  return apiNodes.map(transformNodeFromApi);
}

export function transformTasksFromApi(apiTasks: any[]): Task[] {
  return apiTasks.map(transformTaskFromApi);
}

export function transformLogsFromApi(apiLogs: any[]): LogEntry[] {
  return apiLogs.map(transformLogFromApi);
}
