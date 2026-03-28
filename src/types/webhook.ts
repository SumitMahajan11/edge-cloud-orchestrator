export type WebhookEventType = 
  | 'task.scheduled'
  | 'task.completed'
  | 'task.failed'
  | 'node.online'
  | 'node.offline'
  | 'node.heartbeat'
  | 'alert.triggered'
  | 'alert.resolved'
  | 'metrics.updated'
  | 'policy.changed'

export interface WebhookConfig {
  id: string
  name: string
  url: string
  events: WebhookEventType[]
  secret?: string
  headers?: Record<string, string>
  enabled: boolean
  createdAt: Date
  updatedAt: Date
  retryCount: number
  timeoutMs: number
}

export type WebhookDeliveryStatus = 'pending' | 'success' | 'failed' | 'retrying'

export interface WebhookDelivery {
  id: string
  webhookId: string
  webhookName: string
  event: WebhookEventType
  payload: unknown
  status: WebhookDeliveryStatus
  responseStatus?: number
  responseBody?: string
  errorMessage?: string
  attemptCount: number
  createdAt: Date
  completedAt?: Date
  nextRetryAt?: Date
}

export interface WebhookPayload {
  event: WebhookEventType
  timestamp: string
  data: unknown
}

export interface TaskScheduledPayload extends WebhookPayload {
  event: 'task.scheduled'
  data: {
    taskId: string
    taskName: string
    target: 'edge' | 'cloud'
    nodeId?: string
    nodeName?: string
    reason: string
    policy: string
  }
}

export interface TaskCompletedPayload extends WebhookPayload {
  event: 'task.completed'
  data: {
    taskId: string
    taskName: string
    duration: number
    cost: number
    output?: string
  }
}

export interface TaskFailedPayload extends WebhookPayload {
  event: 'task.failed'
  data: {
    taskId: string
    taskName: string
    error: string
    retryCount: number
    maxRetries: number
  }
}

export interface NodeStatusPayload extends WebhookPayload {
  event: 'node.online' | 'node.offline' | 'node.heartbeat'
  data: {
    nodeId: string
    nodeName: string
    status: string
    cpu?: number
    memory?: number
    latency?: number
    uptime?: number
  }
}

export interface AlertPayload extends WebhookPayload {
  event: 'alert.triggered' | 'alert.resolved'
  data: {
    alertId: string
    ruleName: string
    severity: 'critical' | 'warning' | 'info'
    message: string
    nodeId?: string
    metric?: string
    value?: number
    threshold?: number
  }
}

export interface MetricsPayload extends WebhookPayload {
  event: 'metrics.updated'
  data: {
    nodesOnline: number
    totalNodes: number
    tasksCompleted: number
    tasksFailed: number
    avgLatency: number
    totalCost: number
    healthScore: number
  }
}

export interface PolicyChangedPayload extends WebhookPayload {
  event: 'policy.changed'
  data: {
    oldPolicy: string
    newPolicy: string
    changedBy: string
  }
}
