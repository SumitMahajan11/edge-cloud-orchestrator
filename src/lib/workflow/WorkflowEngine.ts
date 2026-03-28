/**
 * Workflow Orchestration - DAG-based Task Execution Engine
 */

import { logger } from '../logger'
import type { Task, TaskPriority, TaskStatus } from '../../types'

// Types
export interface WorkflowDefinition {
  id: string
  name: string
  version: string
  description?: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  variables: Record<string, unknown>
  timeout: number
  retryPolicy: RetryPolicy
}

export interface WorkflowNode {
  id: string
  name: string
  type: 'task' | 'decision' | 'parallel' | 'subworkflow' | 'wait' | 'notification'
  config: Record<string, unknown>
  inputs: string[]
  outputs: string[]
  retryPolicy?: RetryPolicy
  timeout?: number
}

export interface WorkflowEdge {
  id: string
  from: string
  to: string
  condition?: string // Expression for conditional edges
  label?: string
}

export interface RetryPolicy {
  maxRetries: number
  initialDelay: number
  maxDelay: number
  multiplier: number
}

export interface WorkflowExecution {
  id: string
  workflowId: string
  workflowVersion: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'
  startTime: number
  endTime?: number
  currentNode: string | null
  completedNodes: string[]
  failedNodes: string[]
  variables: Record<string, unknown>
  nodeOutputs: Map<string, unknown>
  executionPath: string[]
  error?: string
}

export interface NodeExecution {
  nodeId: string
  executionId: string
  status: TaskStatus
  startTime: number
  endTime?: number
  output?: unknown
  error?: string
  retryCount: number
}

type WorkflowEvent = 'workflow.started' | 'workflow.completed' | 'workflow.failed' | 'node.started' | 'node.completed' | 'node.failed'
type WorkflowCallback = (event: WorkflowEvent, data: unknown) => void

/**
 * Workflow Engine - Executes DAG-based workflows
 */
export class WorkflowEngine {
  private definitions: Map<string, WorkflowDefinition> = new Map()
  private executions: Map<string, WorkflowExecution> = new Map()
  private nodeExecutions: Map<string, NodeExecution> = new Map()
  private callbacks: Map<WorkflowEvent, Set<WorkflowCallback>> = new Map()
  private taskExecutor: ((task: Task) => Promise<unknown>) | null = null

  /**
   * Set task executor
   */
  setTaskExecutor(executor: (task: Task) => Promise<unknown>): void {
    this.taskExecutor = executor
  }

  /**
   * Register workflow definition
   */
  registerWorkflow(definition: WorkflowDefinition): void {
    this.validateDefinition(definition)
    this.definitions.set(definition.id, definition)
    logger.info('Workflow registered', { workflowId: definition.id, name: definition.name })
  }

  /**
   * Validate workflow definition
   */
  private validateDefinition(definition: WorkflowDefinition): void {
    // Check for cycles
    const visited = new Set<string>()
    const recursionStack = new Set<string>()

    const hasCycle = (nodeId: string): boolean => {
      visited.add(nodeId)
      recursionStack.add(nodeId)

      const outgoingEdges = definition.edges.filter(e => e.from === nodeId)
      for (const edge of outgoingEdges) {
        if (!visited.has(edge.to)) {
          if (hasCycle(edge.to)) return true
        } else if (recursionStack.has(edge.to)) {
          return true
        }
      }

      recursionStack.delete(nodeId)
      return false
    }

    const startNodes = this.getStartNodes(definition)
    for (const startNode of startNodes) {
      if (hasCycle(startNode.id)) {
        throw new Error(`Workflow ${definition.id} contains a cycle`)
      }
    }

    // Check all nodes are reachable
    const allNodeIds = new Set(definition.nodes.map(n => n.id))
    const reachable = new Set<string>()
    
    const markReachable = (nodeId: string): void => {
      reachable.add(nodeId)
      const outgoing = definition.edges.filter(e => e.from === nodeId)
      for (const edge of outgoing) {
        if (!reachable.has(edge.to)) {
          markReachable(edge.to)
        }
      }
    }

    for (const startNode of startNodes) {
      markReachable(startNode.id)
    }

    for (const nodeId of allNodeIds) {
      if (!reachable.has(nodeId)) {
        logger.warn(`Node ${nodeId} is not reachable in workflow ${definition.id}`)
      }
    }
  }

  /**
   * Get start nodes (nodes with no incoming edges)
   */
  private getStartNodes(definition: WorkflowDefinition): WorkflowNode[] {
    const hasIncoming = new Set(definition.edges.map(e => e.to))
    return definition.nodes.filter(n => !hasIncoming.has(n.id))
  }

  /**
   * Start workflow execution
   */
  async startWorkflow(workflowId: string, variables: Record<string, unknown> = {}): Promise<WorkflowExecution> {
    const definition = this.definitions.get(workflowId)
    if (!definition) {
      throw new Error(`Workflow ${workflowId} not found`)
    }

    const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    const execution: WorkflowExecution = {
      id: executionId,
      workflowId,
      workflowVersion: definition.version,
      status: 'running',
      startTime: Date.now(),
      currentNode: null,
      completedNodes: [],
      failedNodes: [],
      variables: { ...definition.variables, ...variables },
      nodeOutputs: new Map(),
      executionPath: [],
    }

    this.executions.set(executionId, execution)
    this.emit('workflow.started', { executionId, workflowId })

    logger.info('Workflow started', { executionId, workflowId })

    // Start execution
    await this.executeWorkflow(execution, definition)

    return execution
  }

  /**
   * Execute workflow
   */
  private async executeWorkflow(execution: WorkflowExecution, definition: WorkflowDefinition): Promise<void> {
    try {
      // Get start nodes
      const startNodes = this.getStartNodes(definition)
      
      // Execute from start nodes
      for (const startNode of startNodes) {
        await this.executeNode(execution, definition, startNode)
      }

      // Check if workflow is complete
      if (execution.status === 'running') {
        const allNodesComplete = definition.nodes.every(n => 
          execution.completedNodes.includes(n.id) || execution.failedNodes.includes(n.id)
        )

        if (allNodesComplete) {
          execution.status = 'completed'
          execution.endTime = Date.now()
          this.emit('workflow.completed', { executionId: execution.id })
          logger.info('Workflow completed', { executionId: execution.id })
        }
      }
    } catch (error) {
      execution.status = 'failed'
      execution.error = (error as Error).message
      execution.endTime = Date.now()
      this.emit('workflow.failed', { executionId: execution.id, error: execution.error })
      logger.error('Workflow failed', error as Error, { executionId: execution.id })
    }
  }

  /**
   * Execute a single node
   */
  private async executeNode(
    execution: WorkflowExecution,
    definition: WorkflowDefinition,
    node: WorkflowNode
  ): Promise<void> {
    if (execution.status !== 'running') return
    if (execution.completedNodes.includes(node.id)) return
    if (execution.failedNodes.includes(node.id)) return

    // Check dependencies
    const incomingEdges = definition.edges.filter(e => e.to === node.id)
    for (const edge of incomingEdges) {
      if (!execution.completedNodes.includes(edge.from)) {
        // Dependency not met, wait
        return
      }
    }

    execution.currentNode = node.id
    execution.executionPath.push(node.id)

    const nodeExecutionId = `node-${execution.id}-${node.id}`
    const nodeExecution: NodeExecution = {
      nodeId: node.id,
      executionId: nodeExecutionId,
      status: 'running',
      startTime: Date.now(),
      retryCount: 0,
    }

    this.nodeExecutions.set(nodeExecutionId, nodeExecution)
    this.emit('node.started', { executionId: execution.id, nodeId: node.id })

    logger.debug('Node started', { executionId: execution.id, nodeId: node.id, type: node.type })

    try {
      let output: unknown

      switch (node.type) {
        case 'task':
          output = await this.executeTaskNode(node, execution, definition)
          break
        case 'decision':
          output = await this.executeDecisionNode(node, execution, definition)
          break
        case 'parallel':
          output = await this.executeParallelNode(node, execution, definition)
          break
        case 'wait':
          output = await this.executeWaitNode(node, execution)
          break
        case 'notification':
          output = await this.executeNotificationNode(node, execution)
          break
        case 'subworkflow':
          output = await this.executeSubworkflowNode(node, execution)
          break
        default:
          throw new Error(`Unknown node type: ${node.type}`)
      }

      nodeExecution.status = 'completed'
      nodeExecution.endTime = Date.now()
      nodeExecution.output = output
      execution.completedNodes.push(node.id)
      execution.nodeOutputs.set(node.id, output)

      this.emit('node.completed', { executionId: execution.id, nodeId: node.id, output })
      logger.debug('Node completed', { executionId: execution.id, nodeId: node.id })

      // Execute next nodes
      const outgoingEdges = definition.edges.filter(e => e.from === node.id)
      for (const edge of outgoingEdges) {
        if (edge.condition) {
          const conditionMet = this.evaluateCondition(edge.condition, execution)
          if (!conditionMet) continue
        }

        const nextNode = definition.nodes.find(n => n.id === edge.to)
        if (nextNode) {
          await this.executeNode(execution, definition, nextNode)
        }
      }
    } catch (error) {
      nodeExecution.status = 'failed'
      nodeExecution.endTime = Date.now()
      nodeExecution.error = (error as Error).message
      execution.failedNodes.push(node.id)

      this.emit('node.failed', { executionId: execution.id, nodeId: node.id, error: nodeExecution.error })
      logger.error('Node failed', error as Error, { executionId: execution.id, nodeId: node.id })

      // Check retry policy
      const retryPolicy = node.retryPolicy || definition.retryPolicy
      if (nodeExecution.retryCount < retryPolicy.maxRetries) {
        nodeExecution.retryCount++
        const delay = Math.min(
          retryPolicy.initialDelay * Math.pow(retryPolicy.multiplier, nodeExecution.retryCount),
          retryPolicy.maxDelay
        )

        await new Promise(resolve => setTimeout(resolve, delay))
        execution.failedNodes = execution.failedNodes.filter(id => id !== node.id)
        await this.executeNode(execution, definition, node)
      }
    }
  }

  /**
   * Execute task node
   */
  private async executeTaskNode(
    node: WorkflowNode,
    execution: WorkflowExecution,
    _definition: WorkflowDefinition
  ): Promise<unknown> {
    if (!this.taskExecutor) {
      throw new Error('Task executor not configured')
    }

    const task: Task = {
      id: `task-${execution.id}-${node.id}`,
      name: node.name,
      type: node.config['taskType'] as Task['type'] || 'Data Aggregation',
      status: 'pending',
      target: 'edge',
      priority: (node.config['priority'] as TaskPriority) || 'medium',
      submittedAt: new Date(),
      duration: 0,
      cost: 0,
      latencyMs: 0,
      reason: `Workflow task: ${node.name}`,
      retryCount: 0,
      maxRetries: 3,
    }

    return await this.taskExecutor(task)
  }

  /**
   * Execute decision node
   */
  private async executeDecisionNode(
    node: WorkflowNode,
    execution: WorkflowExecution,
    _definition: WorkflowDefinition
  ): Promise<string> {
    const expression = node.config['expression'] as string
    const result = this.evaluateExpression(expression, execution.variables)
    return result ? 'true' : 'false'
  }

  /**
   * Execute parallel node
   */
  private async executeParallelNode(
    node: WorkflowNode,
    execution: WorkflowExecution,
    definition: WorkflowDefinition
  ): Promise<unknown[]> {
    const branchNodes = node.config['branches'] as string[] || []
    const results: unknown[] = []

    for (const branchNodeId of branchNodes) {
      const branchNode = definition.nodes.find(n => n.id === branchNodeId)
      if (branchNode) {
        // Execute in parallel (simplified - would use Promise.all in production)
        const result = await this.executeNode(execution, definition, branchNode)
        results.push(result)
      }
    }

    return results
  }

  /**
   * Execute wait node
   */
  private async executeWaitNode(node: WorkflowNode, _execution: WorkflowExecution): Promise<void> {
    const duration = node.config['duration'] as number || 1000
    await new Promise(resolve => setTimeout(resolve, duration))
  }

  /**
   * Execute notification node
   */
  private async executeNotificationNode(node: WorkflowNode, execution: WorkflowExecution): Promise<void> {
    const message = node.config['message'] as string || 'Workflow notification'
    logger.info('Workflow notification', { executionId: execution.id, message })
  }

  /**
   * Execute subworkflow node
   */
  private async executeSubworkflowNode(node: WorkflowNode, _execution: WorkflowExecution): Promise<unknown> {
    const subWorkflowId = node.config['workflowId'] as string
    if (!subWorkflowId) return null

    // Would recursively start subworkflow
    logger.info('Starting subworkflow', { subWorkflowId })
    return { subWorkflowId }
  }

  /**
   * Evaluate condition expression
   */
  private evaluateCondition(expression: string, execution: WorkflowExecution): boolean {
    try {
      // Simple expression evaluation (in production, use a proper expression engine)
      const result = this.evaluateExpression(expression, execution.variables)
      return Boolean(result)
    } catch {
      return false
    }
  }

  /**
   * Evaluate expression
   */
  private evaluateExpression(expression: string, variables: Record<string, unknown>): unknown {
    // Simple variable substitution
    let result = expression
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), String(value))
    }
    return result
  }

  /**
   * Get execution status
   */
  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId)
  }

  /**
   * Cancel execution
   */
  cancelExecution(executionId: string): boolean {
    const execution = this.executions.get(executionId)
    if (!execution || execution.status !== 'running') return false

    execution.status = 'cancelled'
    execution.endTime = Date.now()
    logger.info('Workflow cancelled', { executionId })
    return true
  }

  /**
   * Pause execution
   */
  pauseExecution(executionId: string): boolean {
    const execution = this.executions.get(executionId)
    if (!execution || execution.status !== 'running') return false

    execution.status = 'paused'
    logger.info('Workflow paused', { executionId })
    return true
  }

  /**
   * Resume execution
   */
  async resumeExecution(executionId: string): Promise<boolean> {
    const execution = this.executions.get(executionId)
    if (!execution || execution.status !== 'paused') return false

    execution.status = 'running'
    const definition = this.definitions.get(execution.workflowId)
    if (definition) {
      await this.executeWorkflow(execution, definition)
    }
    return true
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalWorkflows: number
    totalExecutions: number
    runningExecutions: number
    completedExecutions: number
    failedExecutions: number
  } {
    let running = 0
    let completed = 0
    let failed = 0

    for (const execution of this.executions.values()) {
      if (execution.status === 'running') running++
      if (execution.status === 'completed') completed++
      if (execution.status === 'failed') failed++
    }

    return {
      totalWorkflows: this.definitions.size,
      totalExecutions: this.executions.size,
      runningExecutions: running,
      completedExecutions: completed,
      failedExecutions: failed,
    }
  }

  /**
   * Subscribe to events
   */
  on(event: WorkflowEvent, callback: WorkflowCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: WorkflowEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Workflow callback error', error as Error)
      }
    })
  }
}

/**
 * Create workflow engine
 */
export function createWorkflowEngine(): WorkflowEngine {
  return new WorkflowEngine()
}

// Default instance
export const workflowEngine = new WorkflowEngine()
