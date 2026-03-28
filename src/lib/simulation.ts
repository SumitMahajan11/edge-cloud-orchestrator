import type {
  EdgeNode,
  Task,
  LogEntry,
  SystemMetrics,
  ExecutionTarget,
  SchedulingPolicy,
  LogLevel,
  TaskPriority,
  TaskType,
  SchedulingResult,
} from '../types'
import { generateId, getRandomInt, getRandomFloat, clamp } from './utils'
import { predictiveScheduler } from './predictive-scheduler'

const LOCATIONS = [
  { city: 'New York', region: 'us-east' },
  { city: 'San Francisco', region: 'us-west' },
  { city: 'London', region: 'eu-west' },
  { city: 'Frankfurt', region: 'eu-central' },
  { city: 'Singapore', region: 'apac-south' },
  { city: 'Tokyo', region: 'apac-north' },
  { city: 'Sydney', region: 'apac-oceania' },
  { city: 'Sao Paulo', region: 'latam' },
  { city: 'Mumbai', region: 'apac-india' },
  { city: 'Dubai', region: 'me-south' },
]

const TASK_TYPES: TaskType[] = [
  'Image Classification',
  'Data Aggregation',
  'Model Inference',
  'Sensor Fusion',
  'Video Processing',
  'Log Analysis',
  'Anomaly Detection',
]

const TASK_DURATIONS: Record<TaskType, { min: number; max: number }> = {
  'Image Classification': { min: 500, max: 2000 },
  'Data Aggregation': { min: 1000, max: 5000 },
  'Model Inference': { min: 200, max: 1500 },
  'Sensor Fusion': { min: 300, max: 1200 },
  'Video Processing': { min: 2000, max: 10000 },
  'Log Analysis': { min: 500, max: 3000 },
  'Anomaly Detection': { min: 400, max: 2500 },
}

const PRIORITY_MULTIPLIERS: Record<TaskPriority, number> = {
  low: 0.8,
  medium: 1.0,
  high: 1.3,
  critical: 2.0,
}

export function createInitialNodes(count: number): EdgeNode[] {
  const nodes: EdgeNode[] = []
  
  for (let i = 0; i < count; i++) {
    const location = LOCATIONS[i % LOCATIONS.length]
    const node: EdgeNode = {
      id: generateId(),
      name: `edge-${location.region}-${String(i + 1).padStart(2, '0')}`,
      location: location.city,
      region: location.region,
      status: 'online',
      cpu: getRandomFloat(20, 60),
      memory: getRandomFloat(30, 70),
      storage: getRandomFloat(100, 500),
      latency: getRandomFloat(10, 100),
      uptime: getRandomFloat(95, 99.9),
      tasksRunning: 0,
      maxTasks: getRandomInt(5, 20),
      lastHeartbeat: new Date(),
      ip: `10.${getRandomInt(0, 255)}.${getRandomInt(0, 255)}.${getRandomInt(1, 254)}`,
      url: `http://localhost:${4001 + i}`, // Simulated agent URLs
      costPerHour: getRandomFloat(0.01, 0.05),
      bandwidthIn: getRandomFloat(10, 100),
      bandwidthOut: getRandomFloat(10, 100),
      healthHistory: [],
      isMaintenanceMode: false,
    }
    nodes.push(node)
  }
  
  return nodes
}

export function simulateNodeFluctuation(nodes: EdgeNode[]): { updatedNodes: EdgeNode[]; logs: LogEntry[] } {
  const updatedNodes: EdgeNode[] = []
  const logs: LogEntry[] = []
  
  for (const node of nodes) {
    const updatedNode = { ...node }
    
    if (node.status === 'offline') {
      if (Math.random() < 0.1) {
        updatedNode.status = 'online'
        updatedNode.lastHeartbeat = new Date()
        logs.push(createLogEntry('info', 'Node Recovery', `Node ${node.name} has recovered and is back online`, { nodeId: node.id }))
      }
    } else {
      updatedNode.cpu = clamp(node.cpu + getRandomFloat(-10, 10), 5, 95)
      updatedNode.memory = clamp(node.memory + getRandomFloat(-8, 8), 10, 90)
      updatedNode.latency = clamp(node.latency + getRandomFloat(-15, 15), 5, 200)
      updatedNode.lastHeartbeat = new Date()
      
      updatedNode.healthHistory.push({
        timestamp: new Date(),
        cpu: updatedNode.cpu,
        memory: updatedNode.memory,
        latency: updatedNode.latency,
      })
      
      if (updatedNode.healthHistory.length > 50) {
        updatedNode.healthHistory.shift()
      }
      
      if (Math.random() < 0.02) {
        updatedNode.status = 'degraded'
        logs.push(createLogEntry('warn', 'Node Status', `Node ${node.name} status degraded due to high load`, { nodeId: node.id, cpu: updatedNode.cpu }))
      } else if (Math.random() < 0.01) {
        updatedNode.status = 'offline'
        logs.push(createLogEntry('error', 'Node Failure', `Node ${node.name} went offline unexpectedly`, { nodeId: node.id }))
      } else if (node.status === 'degraded' && updatedNode.cpu < 70 && Math.random() < 0.3) {
        updatedNode.status = 'online'
        logs.push(createLogEntry('info', 'Node Recovery', `Node ${node.name} recovered from degraded state`, { nodeId: node.id }))
      }
    }
    
    updatedNodes.push(updatedNode)
  }
  
  return { updatedNodes, logs }
}

export function scheduleTask(
  name: string,
  type: TaskType,
  priority: TaskPriority,
  nodes: EdgeNode[],
  policy: SchedulingPolicy
): SchedulingResult {
  const taskId = generateId()
  const onlineNodes = nodes.filter(n => n.status !== 'offline' && !n.isMaintenanceMode)
  
  if (onlineNodes.length === 0) {
    const task: Task = {
      id: taskId,
      name,
      type,
      status: 'failed',
      target: 'cloud',
      priority,
      submittedAt: new Date(),
      duration: 0,
      cost: 0,
      latencyMs: 0,
      reason: 'No online nodes available - task failed',
      retryCount: 0,
      maxRetries: 3,
    }
    return {
      task,
      logs: [createLogEntry('error', 'Scheduler', `Task "${name}" failed - no online nodes available`, { taskId })],
    }
  }
  
  let selectedNode: EdgeNode | null = null
  let target: ExecutionTarget = 'edge'
  let reason = ''
  
  // Try predictive scheduling first if we have history
  const predictedNode = predictiveScheduler.predictBestNode(
    { id: taskId, name, type, priority, submittedAt: new Date(), status: 'pending', target: 'edge', duration: 0, cost: 0, latencyMs: 0, reason: '', retryCount: 0, maxRetries: 3 },
    onlineNodes
  )
  
  if (predictedNode) {
    const prediction = predictiveScheduler.predictExecutionTime(
      { id: taskId, name, type, priority, submittedAt: new Date(), status: 'pending', target: 'edge', duration: 0, cost: 0, latencyMs: 0, reason: '', retryCount: 0, maxRetries: 3 },
      predictedNode
    )
    
    if (prediction.confidence > 0.6 && prediction.estimated < 5000) {
      selectedNode = predictedNode
      reason = `AI-predicted optimal node (${prediction.estimated.toFixed(0)}ms, ${(prediction.confidence * 100).toFixed(0)}% confidence)`
    }
  }
  
  // Fall back to policy-based selection if no prediction
  if (!selectedNode) {
  try {
    switch (policy) {
      case 'latency-aware': {
        const bestNode = onlineNodes.reduce((best, node) => 
          node.latency < best.latency ? node : best
        )
        if (bestNode.latency < 50 && bestNode.cpu < 80) {
          selectedNode = bestNode
          reason = `Low latency (${bestNode.latency.toFixed(1)}ms) and acceptable CPU (${bestNode.cpu.toFixed(1)}%)`
        } else {
          target = 'cloud'
          reason = `Edge latency too high (${bestNode.latency.toFixed(1)}ms) or CPU saturated (${bestNode.cpu.toFixed(1)}%) - routed to cloud`
        }
        break
      }
      
      case 'cost-aware': {
        const cheapestNode = onlineNodes.reduce((cheapest, node) => 
          node.costPerHour < cheapest.costPerHour ? node : cheapest
        )
        if (cheapestNode.cpu < 70) {
          selectedNode = cheapestNode
          reason = `Cost-optimized (${cheapestNode.costPerHour.toFixed(4)}/hr) with acceptable load (${cheapestNode.cpu.toFixed(1)}%)`
        } else {
          target = 'cloud'
          reason = `Cheapest node overloaded (${cheapestNode.cpu.toFixed(1)}%) - routed to cloud for cost efficiency`
        }
        break
      }
      
      case 'round-robin': {
        const leastLoaded = onlineNodes.reduce((least, node) => 
          node.tasksRunning < least.tasksRunning ? node : least
        )
        if (leastLoaded.tasksRunning < leastLoaded.maxTasks) {
          selectedNode = leastLoaded
          reason = `Round-robin selection - fewest tasks (${leastLoaded.tasksRunning}/${leastLoaded.maxTasks})`
        } else {
          target = 'cloud'
          reason = 'All edge nodes at capacity - routed to cloud'
        }
        break
      }
      
      case 'load-balanced': {
        const scoredNodes = onlineNodes.map(node => ({
          node,
          score: node.cpu * 0.4 + node.memory * 0.3 + (node.latency / 2) * 0.3,
        }))
        scoredNodes.sort((a, b) => a.score - b.score)
        const bestScored = scoredNodes[0]
        if (bestScored.score < 60) {
          selectedNode = bestScored.node
          reason = `Load-balanced (score: ${bestScored.score.toFixed(1)}) - optimal resource utilization`
        } else {
          target = 'cloud'
          reason = `Edge load too high (score: ${bestScored.score.toFixed(1)}) - routed to cloud for load balancing`
        }
        break
      }
      
      default:
        throw new Error(`Unknown scheduling policy: ${policy}`)
    }
  } catch (error) {
    target = 'cloud'
    reason = `Scheduling error: ${error instanceof Error ? error.message : 'Unknown error'} - fallback to cloud`
  }
  } // Close if (!selectedNode) block
  
  const durationRange = TASK_DURATIONS[type]
  const baseDuration = getRandomInt(durationRange.min, durationRange.max)
  const duration = Math.round(baseDuration * PRIORITY_MULTIPLIERS[priority])
  
  let cost = 0
  if (target === 'edge' && selectedNode) {
    cost = (selectedNode.costPerHour / 3600) * (duration / 1000)
  } else {
    cost = 0.0001 * (duration / 1000)
  }
  
  const task: Task = {
    id: taskId,
    name,
    type,
    status: 'scheduled',
    target,
    priority,
    submittedAt: new Date(),
    duration,
    nodeId: selectedNode?.id,
    cost,
    latencyMs: selectedNode?.latency || getRandomFloat(50, 150),
    reason,
    retryCount: 0,
    maxRetries: 3,
  }
  
  const logs: LogEntry[] = [
    createLogEntry('info', 'Scheduler', `Task "${name}" scheduled (${type}, ${priority} priority)`, { taskId, policy }),
  ]
  
  if (target === 'edge' && selectedNode) {
    logs.push(createLogEntry('debug', 'Scheduler', `Routed to edge node ${selectedNode.name}: ${reason}`, { taskId, nodeId: selectedNode.id }))
  } else {
    logs.push(createLogEntry('debug', 'Scheduler', `Routed to cloud: ${reason}`, { taskId }))
  }
  
  return { task, logs }
}

export function computeMetrics(nodes: EdgeNode[], tasks: Task[]): SystemMetrics {
  const onlineNodes = nodes.filter(n => n.status === 'online')
  const offlineNodes = nodes.filter(n => n.status === 'offline')
  const degradedNodes = nodes.filter(n => n.status === 'degraded')
  
  const pendingTasks = tasks.filter(t => t.status === 'pending')
  const runningTasks = tasks.filter(t => t.status === 'running')
  const completedTasks = tasks.filter(t => t.status === 'completed')
  const failedTasks = tasks.filter(t => t.status === 'failed')
  
  const avgLatency = onlineNodes.length > 0
    ? onlineNodes.reduce((sum, n) => sum + n.latency, 0) / onlineNodes.length
    : 0
  
  const totalCost = tasks.reduce((sum, t) => sum + t.cost, 0)
  
  const edgeUtilization = onlineNodes.length > 0
    ? onlineNodes.reduce((sum, n) => sum + n.cpu, 0) / onlineNodes.length
    : 0
  
  const cloudTasks = tasks.filter(t => t.target === 'cloud')
  const cloudUtilization = cloudTasks.length > 0
    ? cloudTasks.reduce((sum, t) => sum + (t.status === 'running' ? 1 : 0), 0) / cloudTasks.length * 100
    : 0
  
  const throughput = completedTasks.length > 0
    ? completedTasks.length / Math.max(1, (Date.now() - Math.min(...completedTasks.map(t => t.submittedAt.getTime()))) / 60000)
    : 0
  
  const cpuHistory = onlineNodes.map(n => ({
    timestamp: new Date(),
    value: n.cpu,
  }))
  
  const edgeTasks = tasks.filter(t => t.target === 'edge').length
  const cloudTaskCount = tasks.filter(t => t.target === 'cloud').length
  
  const total = edgeTasks + cloudTaskCount
  const healthScore = total > 0
    ? Math.round((completedTasks.length / total) * 100 - (failedTasks.length / total) * 50 + (onlineNodes.length / nodes.length) * 25)
    : 100
  
  const completionRate = tasks.length > 0
    ? (completedTasks.length / tasks.length) * 100
    : 0
  
  return {
    totalNodes: nodes.length,
    onlineNodes: onlineNodes.length,
    offlineNodes: offlineNodes.length,
    degradedNodes: degradedNodes.length,
    totalTasks: tasks.length,
    pendingTasks: pendingTasks.length,
    runningTasks: runningTasks.length,
    completedTasks: completedTasks.length,
    failedTasks: failedTasks.length,
    avgLatency,
    totalCost,
    edgeUtilization,
    cloudUtilization,
    throughput,
    cpuHistory,
    taskDistribution: { edge: edgeTasks, cloud: cloudTaskCount },
    healthScore: clamp(healthScore, 0, 100),
    completionRate,
    costOverTime: [{ timestamp: new Date(), value: totalCost }],
  }
}

export function createLogEntry(
  level: LogLevel,
  source: string,
  message: string,
  metadata?: Record<string, unknown>
): LogEntry {
  return {
    id: generateId(),
    timestamp: new Date(),
    level,
    source,
    message,
    metadata,
  }
}

export function generateRandomTaskName(): string {
  const prefixes = ['Process', 'Analyze', 'Compute', 'Transform', 'Sync', 'Validate', 'Index']
  const suffixes = ['Batch', 'Stream', 'Job', 'Task', 'Operation', 'Workflow', 'Pipeline']
  return `${prefixes[getRandomInt(0, prefixes.length - 1)]}-${suffixes[getRandomInt(0, suffixes.length - 1)]}-${getRandomInt(1000, 9999)}`
}

export function getRandomTaskType(): TaskType {
  return TASK_TYPES[getRandomInt(0, TASK_TYPES.length - 1)]
}

export function getRandomPriority(): TaskPriority {
  const priorities: TaskPriority[] = ['low', 'medium', 'high', 'critical']
  const weights = [0.4, 0.35, 0.2, 0.05]
  const random = Math.random()
  let cumulative = 0
  for (let i = 0; i < priorities.length; i++) {
    cumulative += weights[i]
    if (random <= cumulative) return priorities[i]
  }
  return 'medium'
}
