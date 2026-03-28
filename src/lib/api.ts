import type { EdgeNode, Task, LogEntry, SchedulingPolicy, TaskType, TaskPriority } from '../types'
import { generateId } from './utils'

// Simulated API with realistic network latency
const API_DELAY = {
  min: 50,
  max: 300,
}

function simulateNetworkDelay(): Promise<void> {
  const delay = Math.random() * (API_DELAY.max - API_DELAY.min) + API_DELAY.min
  return new Promise(resolve => setTimeout(resolve, delay))
}

function simulateError(chance = 0.02): boolean {
  return Math.random() < chance
}

// API Response types
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  timestamp: string
}

// Mock API Client
export const api = {
  // Nodes
  async getNodes(): Promise<ApiResponse<EdgeNode[]>> {
    await simulateNetworkDelay()
    
    if (simulateError()) {
      return {
        success: false,
        error: 'Failed to fetch nodes: Network timeout',
        timestamp: new Date().toISOString(),
      }
    }
    
    const stored = localStorage.getItem('api_nodes')
    const nodes = stored ? JSON.parse(stored) : []
    
    return {
      success: true,
      data: nodes,
      timestamp: new Date().toISOString(),
    }
  },

  async createNode(nodeData: Partial<EdgeNode>): Promise<ApiResponse<EdgeNode>> {
    await simulateNetworkDelay()
    
    if (simulateError()) {
      return {
        success: false,
        error: 'Failed to create node: Server error',
        timestamp: new Date().toISOString(),
      }
    }
    
    const newNode: EdgeNode = {
      id: generateId(),
      name: nodeData.name || `node-${generateId().slice(0, 6)}`,
      location: nodeData.location || 'Unknown',
      region: nodeData.region || 'unknown',
      status: 'online',
      cpu: 20,
      memory: 30,
      storage: 100,
      latency: 20,
      uptime: 99.9,
      tasksRunning: 0,
      maxTasks: 10,
      lastHeartbeat: new Date(),
      ip: `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`,
      costPerHour: 0.02,
      bandwidthIn: 50,
      bandwidthOut: 50,
      healthHistory: [],
      isMaintenanceMode: false,
      ...nodeData,
    } as EdgeNode
    
    const stored = localStorage.getItem('api_nodes')
    const nodes = stored ? JSON.parse(stored) : []
    nodes.push(newNode)
    localStorage.setItem('api_nodes', JSON.stringify(nodes))
    
    return {
      success: true,
      data: newNode,
      timestamp: new Date().toISOString(),
    }
  },

  async deleteNode(nodeId: string): Promise<ApiResponse<void>> {
    await simulateNetworkDelay()
    
    const stored = localStorage.getItem('api_nodes')
    if (!stored) {
      return {
        success: false,
        error: 'Node not found',
        timestamp: new Date().toISOString(),
      }
    }
    
    const nodes = JSON.parse(stored)
    const filtered = nodes.filter((n: EdgeNode) => n.id !== nodeId)
    localStorage.setItem('api_nodes', JSON.stringify(filtered))
    
    return {
      success: true,
      timestamp: new Date().toISOString(),
    }
  },

  // Tasks
  async getTasks(): Promise<ApiResponse<Task[]>> {
    await simulateNetworkDelay()
    
    const stored = localStorage.getItem('api_tasks')
    const tasks = stored ? JSON.parse(stored) : []
    
    return {
      success: true,
      data: tasks,
      timestamp: new Date().toISOString(),
    }
  },

  async createTask(
    name: string,
    type: TaskType,
    priority: TaskPriority,
    policy: SchedulingPolicy
  ): Promise<ApiResponse<Task>> {
    await simulateNetworkDelay()
    
    const newTask: Task = {
      id: generateId(),
      name,
      type,
      status: 'pending',
      target: 'edge',
      priority,
      submittedAt: new Date(),
      duration: Math.floor(Math.random() * 3000) + 500,
      cost: Math.random() * 0.001,
      latencyMs: Math.random() * 100,
      reason: `Created via API with ${policy} policy`,
      retryCount: 0,
      maxRetries: 3,
    }
    
    const stored = localStorage.getItem('api_tasks')
    const tasks = stored ? JSON.parse(stored) : []
    tasks.push(newTask)
    localStorage.setItem('api_tasks', JSON.stringify(tasks))
    
    return {
      success: true,
      data: newTask,
      timestamp: new Date().toISOString(),
    }
  },

  // Logs
  async getLogs(limit = 100): Promise<ApiResponse<LogEntry[]>> {
    await simulateNetworkDelay()
    
    const stored = localStorage.getItem('api_logs')
    const logs = stored ? JSON.parse(stored).slice(-limit) : []
    
    return {
      success: true,
      data: logs,
      timestamp: new Date().toISOString(),
    }
  },

  // Metrics
  async getMetrics(): Promise<ApiResponse<{
    totalNodes: number
    onlineNodes: number
    totalTasks: number
    completedTasks: number
    failedTasks: number
    avgLatency: number
    totalCost: number
  }>> {
    await simulateNetworkDelay()
    
    const nodesStored = localStorage.getItem('api_nodes')
    const tasksStored = localStorage.getItem('api_tasks')
    
    const nodes = nodesStored ? JSON.parse(nodesStored) : []
    const tasks = tasksStored ? JSON.parse(tasksStored) : []
    
    const metrics = {
      totalNodes: nodes.length,
      onlineNodes: nodes.filter((n: EdgeNode) => n.status === 'online').length,
      totalTasks: tasks.length,
      completedTasks: tasks.filter((t: Task) => t.status === 'completed').length,
      failedTasks: tasks.filter((t: Task) => t.status === 'failed').length,
      avgLatency: nodes.length > 0 
        ? nodes.reduce((sum: number, n: EdgeNode) => sum + (n.latency || 0), 0) / nodes.length 
        : 0,
      totalCost: tasks.reduce((sum: number, t: Task) => sum + (t.cost || 0), 0),
    }
    
    return {
      success: true,
      data: metrics,
      timestamp: new Date().toISOString(),
    }
  },

  // Health check
  async healthCheck(): Promise<ApiResponse<{ status: string; version: string }>> {
    await simulateNetworkDelay()
    
    return {
      success: true,
      data: {
        status: 'healthy',
        version: '1.0.0',
      },
      timestamp: new Date().toISOString(),
    }
  },
}

// WebSocket client - uses real WebSocket when available, simulation otherwise
import { websocketPool } from './websocket-pool'
import { wsLogger as logger } from './logger'

export class WebSocketClient {
  private callbacks: Map<string, ((data: unknown) => void)[]> = new Map()
  private isConnected = false
  private reconnectInterval: ReturnType<typeof setInterval> | null = null
  private connectionId: string | null = null
  private realWsUrl: string | null = null
  private useRealWs = false

  constructor(wsUrl?: string) {
    // Check if a real WebSocket URL is provided
    this.realWsUrl = wsUrl || null
    this.useRealWs = !!wsUrl
  }

  async connect() {
    if (this.useRealWs && this.realWsUrl) {
      try {
        // Use real WebSocket pool
        this.connectionId = await websocketPool.acquire(this.realWsUrl)
        this.isConnected = true
        logger.info('Connected to real WebSocket', { url: this.realWsUrl })
        
        // Subscribe to all registered events
        this.callbacks.forEach((_, event) => {
          websocketPool.subscribe(this.connectionId!, event, (data: unknown) => {
            this.emit(event, data)
          })
        })
      } catch (error) {
        logger.error('Failed to connect to real WebSocket, falling back to simulation', error as Error)
        this.useRealWs = false
        this.startSimulation()
      }
    } else {
      this.startSimulation()
    }
  }

  private startSimulation() {
    this.isConnected = true
    logger.info('Using WebSocket simulation')
    
    // Simulate periodic updates
    this.reconnectInterval = setInterval(() => {
      this.emit('metrics', { timestamp: new Date().toISOString() })
    }, 2000)
  }

  disconnect() {
    if (this.useRealWs && this.connectionId) {
      websocketPool.release(this.connectionId)
      this.connectionId = null
    } else if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval)
      this.reconnectInterval = null
    }
    this.isConnected = false
    logger.info('Disconnected')
  }

  on(event: string, callback: (data: unknown) => void) {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, [])
    }
    this.callbacks.get(event)?.push(callback)

    // If using real WebSocket and already connected, subscribe to this event
    if (this.useRealWs && this.connectionId) {
      websocketPool.subscribe(this.connectionId, event, (data: unknown) => {
        callback(data)
      })
    }
  }

  off(event: string, callback: (data: unknown) => void) {
    const callbacks = this.callbacks.get(event)
    if (callbacks) {
      const index = callbacks.indexOf(callback)
      if (index > -1) {
        callbacks.splice(index, 1)
      }
    }
  }

  private emit(event: string, data: unknown) {
    const callbacks = this.callbacks.get(event)
    callbacks?.forEach(cb => {
      try {
        cb(data)
      } catch (error) {
        logger.error('Error in callback', error as Error)
      }
    })
  }

  send(data: unknown): boolean {
    if (!this.isConnected) return false
    
    if (this.useRealWs && this.connectionId) {
      return websocketPool.send(this.connectionId, data)
    }
    
    // Simulation mode - just log
    logger.debug('Send (simulation)', { data })
    return true
  }

  isOpen() {
    return this.isConnected
  }

  // Get WebSocket pool stats
  getPoolStats() {
    return websocketPool.getStats()
  }
}

// Create WebSocket client - will use real WebSocket if VITE_WS_URL env is set
const wsUrl = import.meta.env?.VITE_WS_URL as string | undefined
export const wsClient = new WebSocketClient(wsUrl)
