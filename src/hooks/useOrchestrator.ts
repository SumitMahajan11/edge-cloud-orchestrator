import { useState, useCallback, useRef, useEffect } from 'react'
import type {
  EdgeNode,
  Task,
  LogEntry,
  SystemMetrics,
  SchedulingPolicy,
  TaskPriority,
  TaskType,
  TaskStatus,
} from '../types'
import {
  createInitialNodes,
  simulateNodeFluctuation,
  scheduleTask,
  computeMetrics,
  createLogEntry,
  generateRandomTaskName,
  getRandomTaskType,
  getRandomPriority,
} from '../lib/simulation'
import { generateId } from '../lib/utils'
// Webhook integration available for future use
// import { webhookManager } from '../lib/webhook'

const MAX_LOGS = 500
const SIMULATION_INTERVAL = 2000
const FAILURE_RATE = 0.08
const AUTO_TASK_CHANCE = 0.15

interface OrchestratorState {
  nodes: EdgeNode[]
  tasks: Task[]
  logs: LogEntry[]
  metrics: SystemMetrics
  policy: SchedulingPolicy
  isSimulating: boolean
  cpuHistory: { timestamp: Date; value: number }[]
  costHistory: { timestamp: Date; value: number }[]
}

interface OrchestratorActions {
  setPolicy: (policy: SchedulingPolicy) => void
  setIsSimulating: (value: boolean) => void
  submitTask: (name: string, type: TaskType, priority: TaskPriority) => void
  addNode: () => void
  removeNode: (nodeId: string) => void
  updateNode: (nodeId: string, updates: Partial<EdgeNode>) => void
  retryTask: (taskId: string) => void
  clearLogs: () => void
  addLog: (level: LogEntry['level'], source: string, message: string, metadata?: Record<string, unknown>) => void
}

export function useOrchestrator(): OrchestratorState & OrchestratorActions {
  const [nodes, setNodes] = useState<EdgeNode[]>(() => createInitialNodes(8))
  const [tasks, setTasks] = useState<Task[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [policy, setPolicy] = useState<SchedulingPolicy>('latency-aware')
  const [isSimulating, setIsSimulating] = useState(true)
  const [cpuHistory, setCpuHistory] = useState<{ timestamp: Date; value: number }[]>([])
  const [costHistory, setCostHistory] = useState<{ timestamp: Date; value: number }[]>([])
  
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const taskTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  
  const addLog = useCallback((level: LogEntry['level'], source: string, message: string, metadata?: Record<string, unknown>) => {
    setLogs(prev => {
      const newLog = createLogEntry(level, source, message, metadata)
      const updated = [newLog, ...prev]
      return updated.slice(0, MAX_LOGS)
    })
  }, [])
  
  const updateTaskStatus = useCallback((taskId: string, status: TaskStatus, updates?: Partial<Task>) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task
      
      const updatedTask = { ...task, ...updates, status }
      
      if (status === 'running') {
        updatedTask.startedAt = new Date()
      } else if (status === 'completed' || status === 'failed') {
        updatedTask.completedAt = new Date()
      }
      
      return updatedTask
    }))
  }, [])
  
  const executeTask = useCallback((task: Task) => {
    if (task.target === 'edge' && task.nodeId) {
      setNodes(prev => prev.map(node => 
        node.id === task.nodeId 
          ? { ...node, tasksRunning: node.tasksRunning + 1 }
          : node
      ))
    }
    
    updateTaskStatus(task.id, 'running')
    addLog('info', 'Task Execution', `Task "${task.name}" started execution on ${task.target}`, { taskId: task.id })
    
    const timeout = setTimeout(() => {
      const shouldFail = Math.random() < FAILURE_RATE
      
      if (shouldFail) {
        updateTaskStatus(task.id, 'failed', { reason: 'Execution error: Task failed during processing' })
        addLog('error', 'Task Execution', `Task "${task.name}" failed during execution`, { taskId: task.id })
      } else {
        updateTaskStatus(task.id, 'completed')
        addLog('info', 'Task Execution', `Task "${task.name}" completed successfully`, { taskId: task.id })
      }
      
      if (task.target === 'edge' && task.nodeId) {
        setNodes(prev => prev.map(node => 
          node.id === task.nodeId 
            ? { ...node, tasksRunning: Math.max(0, node.tasksRunning - 1) }
            : node
        ))
      }
      
      taskTimeoutsRef.current.delete(task.id)
    }, task.duration)
    
    taskTimeoutsRef.current.set(task.id, timeout)
  }, [addLog, updateTaskStatus])
  
  const submitTask = useCallback((name: string, type: TaskType, priority: TaskPriority) => {
    try {
      const result = scheduleTask(name, type, priority, nodes, policy)
      
      setTasks(prev => [...prev, result.task])
      setLogs(prev => {
        const updated = [...result.logs, ...prev]
        return updated.slice(0, MAX_LOGS)
      })
      
      setTimeout(() => {
        executeTask(result.task)
      }, 100)
      
      return result.task
    } catch (error) {
      addLog('error', 'Scheduler', `Failed to schedule task: ${error instanceof Error ? error.message : 'Unknown error'}`)
      throw error
    }
  }, [nodes, policy, addLog, executeTask])
  
  const addNode = useCallback(() => {
    try {
      const newNodes = createInitialNodes(1)
      const newNode = { 
        ...newNodes[0], 
        id: generateId(),
        name: `edge-custom-${generateId().slice(0, 6)}`,
      }
      setNodes(prev => [...prev, newNode])
      addLog('info', 'Node Management', `New node "${newNode.name}" registered at ${newNode.location}`, { nodeId: newNode.id })
    } catch (error) {
      addLog('error', 'Node Management', `Failed to add node: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [addLog])
  
  const removeNode = useCallback((nodeId: string) => {
    try {
      const node = nodes.find(n => n.id === nodeId)
      if (!node) {
        addLog('warn', 'Node Management', `Node ${nodeId} not found`)
        return
      }
      
      if (node.tasksRunning > 0) {
        addLog('warn', 'Node Management', `Cannot remove node "${node.name}" - has ${node.tasksRunning} running tasks`)
        return
      }
      
      setNodes(prev => prev.filter(n => n.id !== nodeId))
      addLog('info', 'Node Management', `Node "${node.name}" deregistered`, { nodeId })
    } catch (error) {
      addLog('error', 'Node Management', `Failed to remove node: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [nodes, addLog])
  
  const updateNode = useCallback((nodeId: string, updates: Partial<EdgeNode>) => {
    try {
      setNodes(prev => prev.map(node => 
        node.id === nodeId ? { ...node, ...updates } : node
      ))
    } catch (error) {
      addLog('error', 'Node Management', `Failed to update node: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [addLog])
  
  const retryTask = useCallback((taskId: string) => {
    try {
      const task = tasks.find(t => t.id === taskId)
      if (!task) {
        addLog('warn', 'Task Management', `Task ${taskId} not found`)
        return
      }
      
      if (task.status !== 'failed') {
        addLog('warn', 'Task Management', `Can only retry failed tasks`)
        return
      }
      
      if (task.retryCount >= task.maxRetries) {
        addLog('error', 'Task Management', `Task "${task.name}" exceeded max retries`)
        return
      }
      
      const retriedTask: Task = {
        ...task,
        id: generateId(),
        status: 'scheduled',
        retryCount: task.retryCount + 1,
        submittedAt: new Date(),
        completedAt: undefined,
        startedAt: undefined,
      }
      
      setTasks(prev => [...prev, retriedTask])
      addLog('info', 'Task Management', `Retrying task "${task.name}" (attempt ${retriedTask.retryCount})`, { taskId: retriedTask.id })
      
      setTimeout(() => {
        executeTask(retriedTask)
      }, 100)
    } catch (error) {
      addLog('error', 'Task Management', `Failed to retry task: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [tasks, addLog, executeTask])
  
  const clearLogs = useCallback(() => {
    setLogs([])
    addLog('info', 'System', 'Logs cleared')
  }, [addLog])
  
  const runSimulation = useCallback(() => {
    try {
      setNodes(prevNodes => {
        const { updatedNodes, logs: newLogs } = simulateNodeFluctuation(prevNodes)
        
        if (newLogs.length > 0) {
          setLogs(prev => {
            const updated = [...newLogs, ...prev]
            return updated.slice(0, MAX_LOGS)
          })
        }
        
        return updatedNodes
      })
      
      if (Math.random() < AUTO_TASK_CHANCE) {
        const name = generateRandomTaskName()
        const type = getRandomTaskType()
        const priority = getRandomPriority()
        
        try {
          const result = scheduleTask(name, type, priority, nodes, policy)
          setTasks(prev => [...prev, result.task])
          setLogs(prev => {
            const updated = [...result.logs, ...prev]
            return updated.slice(0, MAX_LOGS)
          })
          
          setTimeout(() => {
            executeTask(result.task)
          }, 100)
        } catch (error) {
          console.error('Auto-task scheduling failed:', error)
        }
      }
    } catch (error) {
      addLog('error', 'Simulation', `Simulation error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [nodes, policy, addLog, executeTask])
  
  useEffect(() => {
    if (isSimulating) {
      intervalRef.current = setInterval(runSimulation, SIMULATION_INTERVAL)
    }
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isSimulating, runSimulation])
  
  useEffect(() => {
    const avgCpu = nodes.length > 0 
      ? nodes.reduce((sum, n) => sum + n.cpu, 0) / nodes.length 
      : 0
    
    setCpuHistory(prev => {
      const updated = [...prev, { timestamp: new Date(), value: avgCpu }]
      return updated.slice(-20)
    })
  }, [nodes])
  
  useEffect(() => {
    const totalCost = tasks.reduce((sum, t) => sum + t.cost, 0)
    setCostHistory(prev => {
      const updated = [...prev, { timestamp: new Date(), value: totalCost }]
      return updated.slice(-50)
    })
  }, [tasks])
  
  useEffect(() => {
    return () => {
      taskTimeoutsRef.current.forEach(timeout => clearTimeout(timeout))
      taskTimeoutsRef.current.clear()
    }
  }, [])
  
  const metrics = computeMetrics(nodes, tasks)
  
  return {
    nodes,
    tasks,
    logs,
    metrics,
    policy,
    isSimulating,
    cpuHistory,
    costHistory,
    setPolicy,
    setIsSimulating,
    submitTask,
    addNode,
    removeNode,
    updateNode,
    retryTask,
    clearLogs,
    addLog,
  }
}
