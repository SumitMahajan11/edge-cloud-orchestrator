export type NodeStatus = 'online' | 'offline' | 'degraded'
export type TaskStatus = 'pending' | 'scheduled' | 'running' | 'completed' | 'failed'
export type ExecutionTarget = 'edge' | 'cloud'
export type SchedulingPolicy = 'latency-aware' | 'cost-aware' | 'round-robin' | 'load-balanced' | 'ml-optimized'
export type LogLevel = 'info' | 'warn' | 'error' | 'debug'
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical'
export type RuntimeType = 'native' | 'docker' | 'wasm'
export type TaskType = 
  | 'Image Classification'
  | 'Data Aggregation'
  | 'Model Inference'
  | 'Sensor Fusion'
  | 'Video Processing'
  | 'Log Analysis'
  | 'Anomaly Detection'
  | 'Data Processing'
  | 'ETL Pipeline'
  | 'Machine Learning Training'
  | 'Natural Language Processing'
  | 'Computer Vision'
  | 'Speech Recognition'
  | 'Recommendation Engine'
  | 'Fraud Detection'
  | 'IoT Data Ingestion'
  | 'Real-time Analytics'
  | 'Batch Processing'
  | 'Container Build'
  | 'CI/CD Pipeline'

export interface EdgeNode {
  id: string
  name: string
  location: string
  region: string
  status: NodeStatus
  cpu: number
  memory: number
  storage: number
  latency: number
  uptime: number
  tasksRunning: number
  maxTasks: number
  lastHeartbeat: Date
  ip: string
  url: string // Agent endpoint URL
  costPerHour: number
  bandwidthIn: number
  bandwidthOut: number
  healthHistory: { timestamp: Date; cpu: number; memory: number; latency: number }[]
  isMaintenanceMode: boolean
}

export interface Task {
  id: string
  name: string
  type: TaskType
  status: TaskStatus
  target: ExecutionTarget
  priority: TaskPriority
  submittedAt: Date
  startedAt?: Date | undefined
  completedAt?: Date | undefined
  duration: number
  nodeId?: string | undefined
  runtime: RuntimeType
  affinity?: string | undefined
  specs?: {
    cpuCores: number
    memoryGB: number
  } | undefined
  cost: number
  latencyMs: number
  reason: string
  dependencies?: string[] | undefined
  retryCount: number
  maxRetries: number
  metadata?: Record<string, unknown> | undefined
}

export interface LogEntry {
  id: string
  timestamp: Date
  level: LogLevel
  source: string
  message: string
  metadata?: Record<string, unknown> | undefined
  taskId?: string | undefined
  nodeId?: string | undefined
}

export interface SchedulingDecision {
  id: string
  taskId: string
  timestamp: Date
  selectedNodeId: string
  policy: string
  score: number
  explanation: {
    top_features: { name: string; contribution: number; direction: 'positive' | 'negative' }[]
  }
  candidateNodes: { nodeId: string; score: number; reason: string }[]
  mlModelVersion: string | null
  fallbackUsed: boolean
}

export interface SystemMetrics {
  totalNodes: number
  onlineNodes: number
  offlineNodes: number
  degradedNodes: number
  totalTasks: number
  pendingTasks: number
  runningTasks: number
  completedTasks: number
  failedTasks: number
  avgLatency: number
  totalCost: number
  edgeUtilization: number
  cloudUtilization: number
  throughput: number
  cpuHistory: { timestamp: Date; value: number }[]
  taskDistribution: { edge: number; cloud: number }
  healthScore: number
  completionRate: number
  costOverTime: { timestamp: Date; value: number }[]
}

export interface SchedulingResult {
  task: Task
  logs: LogEntry[]
}

export interface AlertRuleConfig {
  id: string
  name: string
  metric: 'cpu' | 'memory' | 'latency' | 'uptime'
  operator: '>' | '<' | '>=' | '<=' | '=='
  threshold: number
  duration: number
  enabled: boolean
  createdAt: Date
}

export interface PolicyPerformance {
  policy: SchedulingPolicy
  totalTasks: number
  successRate: number
  avgLatency: number
  avgCost: number
  timestamp: Date
}

export interface CustomPolicy {
  id: string
  name: string
  description: string
  code: string
  isActive: boolean
  createdAt: Date
}

export interface ThemeSettings {
  mode: 'dark' | 'light' | 'system'
  accentColor: string
  reduceMotion: boolean
  soundEnabled: boolean
  soundVolume: number
}

export interface UserPreferences {
  theme: ThemeSettings
  logRetentionSize: number
  autoScrollLogs: boolean
  updateInterval: number
  defaultPolicy: SchedulingPolicy
  dashboardTimeRange: '1m' | '5m' | '15m' | '1h'
}

export interface BatchTaskConfig {
  count: number
  namePrefix: string
  type: TaskType
  priority: TaskPriority
  interval: number
}

export interface TaskTemplate {
  id: string
  name: string
  type: TaskType
  priority: TaskPriority
  description: string
  estimatedDuration: number
  estimatedCost: number
  runtime?: RuntimeType
}

export interface NodeComparison {
  nodeIds: string[]
  metrics: (keyof EdgeNode)[]
}

export interface ExportConfig {
  format: 'csv' | 'json'
  dateRange: { start: Date; end: Date }
  includeMetrics: boolean
  includeLogs: boolean
  includeTasks: boolean
}

export interface AuditLog {
  id: string
  timestamp: Date
  userId: string
  action: string
  details: Record<string, unknown>
  ipAddress: string
  userAgent: string
}

export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'operator' | 'viewer'
  createdAt: Date
  lastLoginAt?: Date | undefined
}

export interface AlertRule {
  id: string
  name: string
  metric: 'cpu' | 'memory' | 'latency' | 'uptime' | 'tasksFailed'
  operator: '>' | '<' | '>=' | '<=' | '=='
  threshold: number
  duration: number // minutes
  enabled: boolean
  createdAt: Date
}

// Re-export webhook types from dedicated module
export type { 
  WebhookConfig, 
  WebhookDelivery,
  WebhookEventType, 
  WebhookPayload 
} from './webhook'
