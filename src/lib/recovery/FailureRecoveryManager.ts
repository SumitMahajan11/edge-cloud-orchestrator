/**
 * Advanced Failure Recovery System
 * Provides comprehensive failure detection, recovery, and self-healing
 */

import { logger } from '../logger'
import type { Task, EdgeNode } from '../../types'

// Types
export interface FailureRecord {
  id: string
  type: 'node_failure' | 'task_failure' | 'network_failure' | 'resource_exhaustion' | 'timeout'
  entityId: string
  entityType: 'node' | 'task' | 'connection'
  timestamp: number
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  context: Record<string, unknown>
  recovered: boolean
  recoveryAttempts: number
  lastRecoveryAttempt?: number
}

export interface RecoveryPlan {
  id: string
  failureId: string
  strategy: 'retry' | 'migrate' | 'restart' | 'failover' | 'scale_out' | 'ignore'
  steps: RecoveryStep[]
  createdAt: number
  status: 'pending' | 'executing' | 'completed' | 'failed'
  result?: string
}

export interface RecoveryStep {
  id: string
  action: string
  params: Record<string, unknown>
  timeout: number
  retryCount: number
  status: 'pending' | 'running' | 'success' | 'failed'
}

export interface HealthCheck {
  nodeId: string
  timestamp: number
  status: 'healthy' | 'degraded' | 'unhealthy'
  checks: {
    cpu: boolean
    memory: boolean
    disk: boolean
    network: boolean
    docker: boolean
  }
  score: number
}

export interface FailureRecoveryConfig {
  maxRecoveryAttempts: number
  recoveryCooldown: number
  healthCheckInterval: number
  failureThreshold: number
  autoRecoveryEnabled: boolean
}

type RecoveryEvent = 'failure.detected' | 'recovery.started' | 'recovery.completed' | 'recovery.failed'
type RecoveryCallback = (event: RecoveryEvent, data: unknown) => void

const DEFAULT_CONFIG: FailureRecoveryConfig = {
  maxRecoveryAttempts: 3,
  recoveryCooldown: 30000, // 30 seconds
  healthCheckInterval: 10000, // 10 seconds
  failureThreshold: 3, // Failures before marking unhealthy
  autoRecoveryEnabled: true,
}

/**
 * Failure Recovery Manager
 */
export class FailureRecoveryManager {
  private config: FailureRecoveryConfig
  private failures: Map<string, FailureRecord> = new Map()
  private recoveryPlans: Map<string, RecoveryPlan> = new Map()
  private healthChecks: Map<string, HealthCheck> = new Map()
  private failureCounts: Map<string, number> = new Map() // entityId -> count
  private callbacks: Map<RecoveryEvent, Set<RecoveryCallback>> = new Map()
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private nodeProvider: (() => EdgeNode[]) | null = null
  private taskRecoverer: ((task: Task, newNodeId: string) => Promise<boolean>) | null = null

  constructor(config: Partial<FailureRecoveryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Set node provider
   */
  setNodeProvider(provider: () => EdgeNode[]): void {
    this.nodeProvider = provider
  }

  /**
   * Set task recoverer
   */
  setTaskRecoverer(recoverer: (task: Task, newNodeId: string) => Promise<boolean>): void {
    this.taskRecoverer = recoverer
  }

  /**
   * Start health monitoring
   */
  startMonitoring(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks()
    }, this.config.healthCheckInterval)
    logger.info('Failure recovery monitoring started')
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  /**
   * Report a failure
   */
  reportFailure(
    type: FailureRecord['type'],
    entityId: string,
    entityType: FailureRecord['entityType'],
    message: string,
    context: Record<string, unknown> = {},
    severity: FailureRecord['severity'] = 'medium'
  ): FailureRecord {
    const failureId = `failure-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    const failure: FailureRecord = {
      id: failureId,
      type,
      entityId,
      entityType,
      timestamp: Date.now(),
      severity,
      message,
      context,
      recovered: false,
      recoveryAttempts: 0,
    }

    this.failures.set(failureId, failure)

    // Update failure count
    const count = (this.failureCounts.get(entityId) || 0) + 1
    this.failureCounts.set(entityId, count)

    this.emit('failure.detected', failure)
    logger.error('Failure detected', new Error(message), { failureId, type, entityId, severity })

    // Auto-recovery if enabled
    if (this.config.autoRecoveryEnabled) {
      this.initiateRecovery(failure)
    }

    return failure
  }

  /**
   * Initiate recovery for a failure
   */
  async initiateRecovery(failure: FailureRecord): Promise<RecoveryPlan | null> {
    // Check cooldown
    if (failure.lastRecoveryAttempt && 
        Date.now() - failure.lastRecoveryAttempt < this.config.recoveryCooldown) {
      logger.warn('Recovery in cooldown', { failureId: failure.id })
      return null
    }

    // Check max attempts
    if (failure.recoveryAttempts >= this.config.maxRecoveryAttempts) {
      logger.error('Max recovery attempts reached', new Error('Max attempts'), { failureId: failure.id })
      return null
    }

    const strategy = this.determineStrategy(failure)
    const steps = this.createRecoverySteps(failure, strategy)

    const plan: RecoveryPlan = {
      id: `plan-${Date.now()}`,
      failureId: failure.id,
      strategy,
      steps,
      createdAt: Date.now(),
      status: 'pending',
    }

    this.recoveryPlans.set(plan.id, plan)
    failure.recoveryAttempts++
    failure.lastRecoveryAttempt = Date.now()

    this.emit('recovery.started', { plan, failure })
    logger.info('Recovery initiated', { planId: plan.id, strategy, failureId: failure.id })

    // Execute recovery
    await this.executeRecovery(plan, failure)

    return plan
  }

  /**
   * Determine recovery strategy
   */
  private determineStrategy(failure: FailureRecord): RecoveryPlan['strategy'] {
    switch (failure.type) {
      case 'node_failure':
        return failure.severity === 'critical' ? 'failover' : 'restart'
      case 'task_failure':
        return failure.context['retryable'] ? 'retry' : 'migrate'
      case 'network_failure':
        return 'failover'
      case 'resource_exhaustion':
        return 'scale_out'
      case 'timeout':
        return 'retry'
      default:
        return 'retry'
    }
  }

  /**
   * Create recovery steps
   */
  private createRecoverySteps(failure: FailureRecord, strategy: RecoveryPlan['strategy']): RecoveryStep[] {
    const steps: RecoveryStep[] = []

    switch (strategy) {
      case 'retry':
        steps.push({
          id: 'retry-1',
          action: 'retry_task',
          params: { taskId: failure.entityId },
          timeout: 30000,
          retryCount: 0,
          status: 'pending',
        })
        break

      case 'migrate':
        steps.push(
          {
            id: 'find-node',
            action: 'find_available_node',
            params: { excludeNodeIds: [failure.context['nodeId']] },
            timeout: 5000,
            retryCount: 0,
            status: 'pending',
          },
          {
            id: 'migrate',
            action: 'migrate_task',
            params: { taskId: failure.entityId },
            timeout: 60000,
            retryCount: 0,
            status: 'pending',
          }
        )
        break

      case 'failover':
        steps.push(
          {
            id: 'select-failover',
            action: 'select_failover_node',
            params: { failedNodeId: failure.entityId },
            timeout: 5000,
            retryCount: 0,
            status: 'pending',
          },
          {
            id: 'transfer-tasks',
            action: 'transfer_running_tasks',
            params: { fromNodeId: failure.entityId },
            timeout: 60000,
            retryCount: 0,
            status: 'pending',
          }
        )
        break

      case 'restart':
        steps.push({
          id: 'restart',
          action: 'restart_node',
          params: { nodeId: failure.entityId },
          timeout: 120000,
          retryCount: 0,
          status: 'pending',
        })
        break

      case 'scale_out':
        steps.push({
          id: 'scale',
          action: 'provision_new_node',
          params: { reason: 'resource_exhaustion' },
          timeout: 300000,
          retryCount: 0,
          status: 'pending',
        })
        break

      case 'ignore':
        steps.push({
          id: 'ignore',
          action: 'mark_ignored',
          params: { failureId: failure.id },
          timeout: 1000,
          retryCount: 0,
          status: 'pending',
        })
        break
    }

    return steps
  }

  /**
   * Execute recovery plan
   */
  private async executeRecovery(plan: RecoveryPlan, failure: FailureRecord): Promise<void> {
    plan.status = 'executing'

    for (const step of plan.steps) {
      step.status = 'running'

      try {
        const success = await this.executeStep(step, failure)
        step.status = success ? 'success' : 'failed'

        if (!success) {
          plan.status = 'failed'
          plan.result = `Step ${step.id} failed`
          this.emit('recovery.failed', { plan, step, failure })
          logger.error('Recovery step failed', new Error(plan.result), { planId: plan.id, stepId: step.id })
          return
        }
      } catch (error) {
        step.status = 'failed'
        plan.status = 'failed'
        plan.result = (error as Error).message
        this.emit('recovery.failed', { plan, step, failure, error })
        logger.error('Recovery step error', error as Error, { planId: plan.id, stepId: step.id })
        return
      }
    }

    plan.status = 'completed'
    failure.recovered = true
    this.emit('recovery.completed', { plan, failure })
    logger.info('Recovery completed', { planId: plan.id, failureId: failure.id })
  }

  /**
   * Execute a single recovery step
   */
  private async executeStep(step: RecoveryStep, failure: FailureRecord): Promise<boolean> {
    // Simulate step execution (in production, would call actual services)
    await new Promise(resolve => setTimeout(resolve, 100))

    switch (step.action) {
      case 'retry_task':
        logger.info('Retrying task', { taskId: failure.entityId })
        return true // Simulated success

      case 'find_available_node':
        if (this.nodeProvider) {
          const excludeIds = step.params['excludeNodeIds'] as string[] | undefined
          const nodes = this.nodeProvider().filter(n => 
            n.status === 'online' && 
            !excludeIds?.includes(n.id)
          )
          return nodes.length > 0
        }
        return false

      case 'migrate_task':
        if (this.taskRecoverer && failure.context['task']) {
          const newNodeId = step.params['targetNodeId'] as string
          return await this.taskRecoverer(failure.context['task'] as Task, newNodeId)
        }
        return true // Simulated

      case 'restart_node':
        logger.info('Restarting node', { nodeId: failure.entityId })
        return true // Simulated

      case 'select_failover_node':
        if (this.nodeProvider) {
          const nodes = this.nodeProvider().filter(n => n.status === 'online')
          step.params['targetNodeId'] = nodes[0]?.id
          return nodes.length > 0
        }
        return false

      case 'transfer_running_tasks':
        logger.info('Transferring tasks', { fromNodeId: failure.entityId })
        return true // Simulated

      case 'provision_new_node':
        logger.info('Provisioning new node')
        return true // Simulated

      default:
        return true
    }
  }

  /**
   * Perform health checks on all nodes
   */
  private performHealthChecks(): void {
    if (!this.nodeProvider) return

    const nodes = this.nodeProvider()

    for (const node of nodes) {
      const check: HealthCheck = {
        nodeId: node.id,
        timestamp: Date.now(),
        status: 'healthy',
        checks: {
          cpu: node.cpu < 90,
          memory: node.memory < 90,
          disk: node.storage > 10,
          network: (node.latency || 0) < 500,
          docker: true, // Assume healthy
        },
        score: 100,
      }

      // Calculate score
      const failedChecks = Object.values(check.checks).filter(c => !c).length
      check.score = Math.max(0, 100 - failedChecks * 20)

      // Determine status
      if (check.score >= 80) {
        check.status = 'healthy'
      } else if (check.score >= 50) {
        check.status = 'degraded'
      } else {
        check.status = 'unhealthy'
      }

      this.healthChecks.set(node.id, check)

      // Report failure if unhealthy
      if (check.status === 'unhealthy') {
        const failureCount = this.failureCounts.get(node.id) || 0
        if (failureCount >= this.config.failureThreshold) {
          this.reportFailure(
            'node_failure',
            node.id,
            'node',
            `Node ${node.id} is unhealthy (score: ${check.score})`,
            { check },
            'high'
          )
        }
      }
    }
  }

  /**
   * Get failure statistics
   */
  getStats(): {
    totalFailures: number
    recoveredFailures: number
    pendingRecoveries: number
    byType: Record<string, number>
    bySeverity: Record<string, number>
  } {
    const byType: Record<string, number> = {}
    const bySeverity: Record<string, number> = {}
    let recovered = 0
    let pending = 0

    for (const failure of this.failures.values()) {
      byType[failure.type] = (byType[failure.type] || 0) + 1
      bySeverity[failure.severity] = (bySeverity[failure.severity] || 0) + 1
      if (failure.recovered) recovered++
      if (!failure.recovered && failure.recoveryAttempts < this.config.maxRecoveryAttempts) pending++
    }

    return {
      totalFailures: this.failures.size,
      recoveredFailures: recovered,
      pendingRecoveries: pending,
      byType,
      bySeverity,
    }
  }

  /**
   * Get health check for node
   */
  getHealthCheck(nodeId: string): HealthCheck | undefined {
    return this.healthChecks.get(nodeId)
  }

  /**
   * Get all health checks
   */
  getAllHealthChecks(): HealthCheck[] {
    return Array.from(this.healthChecks.values())
  }

  /**
   * Subscribe to events
   */
  on(event: RecoveryEvent, callback: RecoveryCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: RecoveryEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Recovery callback error', error as Error)
      }
    })
  }
}

/**
 * Create failure recovery manager
 */
export function createFailureRecoveryManager(config: Partial<FailureRecoveryConfig> = {}): FailureRecoveryManager {
  return new FailureRecoveryManager(config)
}

// Default instance
export const failureRecoveryManager = new FailureRecoveryManager()
