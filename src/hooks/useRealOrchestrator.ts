import { useState, useCallback, useRef, useEffect } from 'react'
import type {
  EdgeNode,
  Task,
  LogEntry,
  SystemMetrics,
  SchedulingPolicy,
  TaskPriority,
  TaskType,
} from '../types'
import { apiClient, nodesApi, tasksApi, metricsApi } from '../lib/api-simple'
import {
  transformNodesFromApi,
  transformTasksFromApi,
  transformMetricsFromApi,
  transformTaskToApi,
  transformNodeToApi
} from '../lib/typeTransformers'
import { wsClient } from '../lib/websocketClient'

const MAX_LOGS = 500
const POLLING_INTERVAL = 5000 // 5 seconds

interface OrchestratorState {
  nodes: EdgeNode[]
  tasks: Task[]
  logs: LogEntry[]
  metrics: SystemMetrics
  policy: SchedulingPolicy
  isLoading: boolean
  error: string | null
  cpuHistory: { timestamp: Date; value: number }[]
  isConnected: boolean
}

interface OrchestratorActions {
  setPolicy: (policy: SchedulingPolicy) => void
  submitTask: (name: string, type: TaskType, priority: TaskPriority) => Promise<boolean>
  addNode: (node: Partial<EdgeNode>) => Promise<boolean>
  removeNode: (nodeId: string) => Promise<boolean>
  updateNode: (nodeId: string, updates: Partial<EdgeNode>) => Promise<boolean>
  retryTask: (taskId: string) => Promise<boolean>
  cancelTask: (taskId: string) => Promise<boolean>
  clearLogs: () => void
  addLog: (level: LogEntry['level'], source: string, message: string, metadata?: Record<string, unknown>) => void
  refresh: () => Promise<void>
}

export function useRealOrchestrator(): OrchestratorState & OrchestratorActions {
  const [nodes, setNodes] = useState<EdgeNode[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [metrics, setMetrics] = useState<SystemMetrics>({
    totalNodes: 0,
    onlineNodes: 0,
    offlineNodes: 0,
    degradedNodes: 0,
    totalTasks: 0,
    runningTasks: 0,
    pendingTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    avgLatency: 0,
    totalCost: 0,
    edgeUtilization: 0,
    cloudUtilization: 0,
    throughput: 0,
    cpuHistory: [],
    taskDistribution: { edge: 0, cloud: 0 },
    healthScore: 100,
    completionRate: 0,
    costOverTime: [],
  })
  const [policy, setPolicy] = useState<SchedulingPolicy>('latency-aware')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cpuHistory, setCpuHistory] = useState<{ timestamp: Date; value: number }[]>([])

  const [isConnected, setIsConnected] = useState(false)
  
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  
  // Add log entry
  const addLog = useCallback((level: LogEntry['level'], source: string, message: string, metadata?: Record<string, unknown>) => {
    const newLog: LogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      level,
      source,
      message,
      metadata,
    }
    setLogs(prev => [newLog, ...prev].slice(0, MAX_LOGS))
  }, [])
  
  // Fetch all data from backend
  const fetchData = useCallback(async () => {
    try {
      const [nodesRes, tasksRes, metricsRes] = await Promise.all([
        nodesApi.list(),
        tasksApi.list(),
        metricsApi.getSystem(),
      ])
      
      if (nodesRes.data) {
        setNodes(transformNodesFromApi(nodesRes.data.data || []))
      }
      
      if (tasksRes.data) {
        setTasks(transformTasksFromApi(tasksRes.data.data || []))
      }
      
      if (metricsRes.data) {
        const transformedMetrics = transformMetricsFromApi(metricsRes.data)
        setMetrics(transformedMetrics)
        
        // Update CPU history
        setCpuHistory(prev => {
          const cpuValue = transformedMetrics.cpuHistory?.length > 0 
            ? transformedMetrics.cpuHistory[transformedMetrics.cpuHistory.length - 1].value 
            : 0
          const newEntry = { timestamp: new Date(), value: cpuValue }
          return [...prev.slice(-59), newEntry]
        })
      }
      
      setError(null)
    } catch (err) {
      console.error('Failed to fetch data:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
    }
  }, [])
  
  // Initial load and polling setup
  useEffect(() => {
    setIsLoading(true)
    fetchData().finally(() => setIsLoading(false))
    
    // Start polling
    pollingRef.current = setInterval(fetchData, POLLING_INTERVAL)
    
    // WebSocket subscriptions
    const unsubNodes = wsClient.subscribe('nodes', (data: any) => {
      if (data.type === 'update') {
        setNodes(prev => prev.map(n => n.id === data.node.id ? transformNodesFromApi([data.node])[0] : n))
      } else if (data.type === 'create') {
        setNodes(prev => [...prev, ...transformNodesFromApi([data.node])])
      } else if (data.type === 'delete') {
        setNodes(prev => prev.filter(n => n.id !== data.nodeId))
      }
    })
    
    const unsubTasks = wsClient.subscribe('tasks', (data: any) => {
      if (data.type === 'update') {
        setTasks(prev => prev.map(t => t.id === data.task.id ? transformTasksFromApi([data.task])[0] : t))
      } else if (data.type === 'create') {
        setTasks(prev => [...prev, ...transformTasksFromApi([data.task])])
      }
      addLog('info', 'Task Update', data.message || `Task ${data.task?.id} updated`)
    })
    
    const unsubConnect = wsClient.onConnect(() => setIsConnected(true))
    const unsubDisconnect = wsClient.onDisconnect(() => setIsConnected(false))
    
    // Connect WebSocket
    wsClient.connect().catch(console.error)
    
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
      unsubNodes()
      unsubTasks()
      unsubConnect()
      unsubDisconnect()
    }
  }, [fetchData, addLog])
  
  // Submit task
  const submitTask = useCallback(async (name: string, type: TaskType, priority: TaskPriority): Promise<boolean> => {
    try {
      const taskData = transformTaskToApi({ name, type, priority })
      const response = await tasksApi.create(taskData)
      
      if (response.error) {
        addLog('error', 'Task Submission', `Failed to submit task: ${response.error}`)
        return false
      }
      
      addLog('info', 'Task Submission', `Task "${name}" submitted successfully`)
      await fetchData() // Refresh data
      return true
    } catch (err) {
      addLog('error', 'Task Submission', `Failed to submit task: ${err}`)
      return false
    }
  }, [addLog, fetchData])
  
  // Add node
  const addNode = useCallback(async (nodeData: Partial<EdgeNode>): Promise<boolean> => {
    try {
      const apiData = transformNodeToApi(nodeData)
      const response = await nodesApi.create(apiData)
      
      if (response.error) {
        addLog('error', 'Node Registration', `Failed to register node: ${response.error}`)
        return false
      }
      
      addLog('info', 'Node Registration', `Node "${nodeData.name}" registered successfully`)
      await fetchData()
      return true
    } catch (err) {
      addLog('error', 'Node Registration', `Failed to register node: ${err}`)
      return false
    }
  }, [addLog, fetchData])
  
  // Remove node
  const removeNode = useCallback(async (nodeId: string): Promise<boolean> => {
    try {
      const response = await nodesApi.delete(nodeId)
      
      if (response.error) {
        addLog('error', 'Node Removal', `Failed to remove node: ${response.error}`)
        return false
      }
      
      addLog('info', 'Node Removal', `Node removed successfully`)
      await fetchData()
      return true
    } catch (err) {
      addLog('error', 'Node Removal', `Failed to remove node: ${err}`)
      return false
    }
  }, [addLog, fetchData])
  
  // Update node
  const updateNode = useCallback(async (nodeId: string, updates: Partial<EdgeNode>): Promise<boolean> => {
    try {
      const response = await nodesApi.update(nodeId, updates)
      
      if (response.error) {
        addLog('error', 'Node Update', `Failed to update node: ${response.error}`)
        return false
      }
      
      addLog('info', 'Node Update', `Node updated successfully`)
      await fetchData()
      return true
    } catch (err) {
      addLog('error', 'Node Update', `Failed to update node: ${err}`)
      return false
    }
  }, [addLog, fetchData])
  
  // Retry task
  const retryTask = useCallback(async (taskId: string): Promise<boolean> => {
    try {
      const response = await tasksApi.retry(taskId)
      
      if (response.error) {
        addLog('error', 'Task Retry', `Failed to retry task: ${response.error}`)
        return false
      }
      
      addLog('info', 'Task Retry', `Task retry initiated`)
      await fetchData()
      return true
    } catch (err) {
      addLog('error', 'Task Retry', `Failed to retry task: ${err}`)
      return false
    }
  }, [addLog, fetchData])
  
  // Cancel task
  const cancelTask = useCallback(async (taskId: string): Promise<boolean> => {
    try {
      const response = await tasksApi.cancel(taskId)
      
      if (response.error) {
        addLog('error', 'Task Cancel', `Failed to cancel task: ${response.error}`)
        return false
      }
      
      addLog('info', 'Task Cancel', `Task cancelled successfully`)
      await fetchData()
      return true
    } catch (err) {
      addLog('error', 'Task Cancel', `Failed to cancel task: ${err}`)
      return false
    }
  }, [addLog, fetchData])
  
  // Clear logs
  const clearLogs = useCallback(() => {
    setLogs([])
  }, [])
  
  // Manual refresh
  const refresh = useCallback(async () => {
    setIsLoading(true)
    await fetchData()
    setIsLoading(false)
  }, [fetchData])
  
  return {
    // State
    nodes,
    tasks,
    logs,
    metrics,
    policy,
    isLoading,
    error,
    cpuHistory,

    isConnected,
    // Actions
    setPolicy,
    submitTask,
    addNode,
    removeNode,
    updateNode,
    retryTask,
    cancelTask,
    clearLogs,
    addLog,
    refresh,
  }
}
