/**
 * Automated Capacity Planning
 * Predict resource needs and auto-scale infrastructure
 */

import { logger } from '../logger'
import type { EdgeNode } from '../../types'

// Types
export interface CapacityPlan {
  id: string
  name: string
  status: 'draft' | 'approved' | 'executing' | 'completed' | 'failed'
  createdAt: number
  targetDate: number
  region: string
  projections: CapacityProjection[]
  actions: CapacityAction[]
  estimatedCost: number
  estimatedSavings: number
  riskLevel: 'low' | 'medium' | 'high'
}

export interface CapacityProjection {
  metric: 'cpu' | 'memory' | 'storage' | 'network' | 'nodes'
  currentValue: number
  projectedValue: number
  projectedAt: number
  unit: string
  confidence: number
  trend: 'increasing' | 'decreasing' | 'stable'
  growthRate: number // % per month
}

export interface CapacityAction {
  id: string
  type: 'scale-up' | 'scale-down' | 'provision' | 'decommission' | 'optimize' | 'reserve'
  resource: string
  currentAmount: number
  targetAmount: number
  unit: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  estimatedImpact: string
  estimatedCost: number
  executionTime: number
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed'
}

export interface CapacityThreshold {
  metric: string
  warningThreshold: number
  criticalThreshold: number
  autoScale: boolean
  scaleByPercent: number
  cooldownMinutes: number
}

export interface CapacityConfig {
  planningHorizonDays: number
  minUtilization: number
  maxUtilization: number
  growthBufferPercent: number
  autoApproveThreshold: number
  enableAutoScaling: boolean
}

export interface ScalingEvent {
  id: string
  action: CapacityAction
  triggeredBy: 'manual' | 'threshold' | 'prediction' | 'schedule'
  triggeredAt: number
  completedAt?: number
  result: 'success' | 'partial' | 'failed'
  details: string
}

type CapacityEvent = 'plan.created' | 'action.approved' | 'action.executed' | 'threshold.breached' | 'scaling.triggered'
type CapacityCallback = (event: CapacityEvent, data: unknown) => void

const DEFAULT_CONFIG: CapacityConfig = {
  planningHorizonDays: 90,
  minUtilization: 30,
  maxUtilization: 80,
  growthBufferPercent: 20,
  autoApproveThreshold: 100, // Auto-approve actions under $100
  enableAutoScaling: true,
}

/**
 * Automated Capacity Planner
 */
export class CapacityPlanner {
  private config: CapacityConfig
  private plans: Map<string, CapacityPlan> = new Map()
  private thresholds: Map<string, CapacityThreshold> = new Map()
  private scalingHistory: Map<string, ScalingEvent> = new Map()
  private callbacks: Map<CapacityEvent, Set<CapacityCallback>> = new Map()
  private nodeProvider: (() => EdgeNode[]) | null = null
  private metricHistory: Map<string, Array<{ timestamp: number; value: number }>> = new Map()
  private planningTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: Partial<CapacityConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.initializeThresholds()
  }

  /**
   * Set node provider
   */
  setNodeProvider(provider: () => EdgeNode[]): void {
    this.nodeProvider = provider
  }

  /**
   * Initialize default thresholds
   */
  private initializeThresholds(): void {
    this.thresholds.set('cpu', {
      metric: 'cpu',
      warningThreshold: 70,
      criticalThreshold: 85,
      autoScale: true,
      scaleByPercent: 20,
      cooldownMinutes: 5,
    })

    this.thresholds.set('memory', {
      metric: 'memory',
      warningThreshold: 75,
      criticalThreshold: 90,
      autoScale: true,
      scaleByPercent: 25,
      cooldownMinutes: 10,
    })

    this.thresholds.set('storage', {
      metric: 'storage',
      warningThreshold: 70,
      criticalThreshold: 85,
      autoScale: false,
      scaleByPercent: 50,
      cooldownMinutes: 60,
    })
  }

  /**
   * Record metric for analysis
   */
  recordMetric(metric: string, value: number): void {
    if (!this.metricHistory.has(metric)) {
      this.metricHistory.set(metric, [])
    }

    const history = this.metricHistory.get(metric)!
    history.push({ timestamp: Date.now(), value })

    // Keep 90 days of data
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
    const filtered = history.filter(h => h.timestamp > cutoff)
    this.metricHistory.set(metric, filtered)

    // Check thresholds
    this.checkThresholds(metric, value)
  }

  /**
   * Check if thresholds are breached
   */
  private checkThresholds(metric: string, value: number): void {
    const threshold = this.thresholds.get(metric)
    if (!threshold || !threshold.autoScale) return

    if (value >= threshold.criticalThreshold) {
      this.emit('threshold.breached', { metric, value, level: 'critical' })
      logger.warn('Critical threshold breached', { metric, value, threshold: threshold.criticalThreshold })
      
      if (this.config.enableAutoScaling) {
        this.triggerAutoScaling(metric, 'critical')
      }
    } else if (value >= threshold.warningThreshold) {
      this.emit('threshold.breached', { metric, value, level: 'warning' })
      logger.info('Warning threshold breached', { metric, value, threshold: threshold.warningThreshold })
    }
  }

  /**
   * Trigger auto-scaling
   */
  private async triggerAutoScaling(metric: string, level: 'warning' | 'critical'): Promise<void> {
    const threshold = this.thresholds.get(metric)
    if (!threshold) return

    const nodes = this.nodeProvider ? this.nodeProvider() : []
    const onlineNodes = nodes.filter(n => n.status === 'online')

    const action: CapacityAction = {
      id: `action-${Date.now()}`,
      type: 'scale-up',
      resource: metric,
      currentAmount: onlineNodes.length,
      targetAmount: Math.ceil(onlineNodes.length * (1 + threshold.scaleByPercent / 100)),
      unit: 'nodes',
      priority: level === 'critical' ? 'critical' : 'high',
      estimatedImpact: `Add ${Math.ceil(onlineNodes.length * threshold.scaleByPercent / 100)} nodes`,
      estimatedCost: 50 * Math.ceil(onlineNodes.length * threshold.scaleByPercent / 100),
      executionTime: 5 * 60 * 1000, // 5 minutes
      status: 'pending',
    }

    const event: ScalingEvent = {
      id: `scale-${Date.now()}`,
      action,
      triggeredBy: 'threshold',
      triggeredAt: Date.now(),
      result: 'success',
      details: `Auto-scaled due to ${level} threshold breach`,
    }

    // Auto-approve if under threshold
    if (action.estimatedCost <= this.config.autoApproveThreshold) {
      action.status = 'approved'
      this.emit('action.approved', { action, autoApproved: true })
    }

    this.scalingHistory.set(event.id, event)
    this.emit('scaling.triggered', event)

    logger.info('Auto-scaling triggered', {
      metric,
      level,
      action: action.type,
      targetAmount: action.targetAmount,
    })

    // Execute scaling (simulated)
    await this.executeAction(action)
  }

  /**
   * Generate capacity plan
   */
  generatePlan(region: string): CapacityPlan {
    const projections = this.generateProjections(region)
    const actions = this.generateActions(projections)
    
    const plan: CapacityPlan = {
      id: `plan-${Date.now()}`,
      name: `Capacity Plan ${region} ${new Date().toISOString().split('T')[0]}`,
      status: 'draft',
      createdAt: Date.now(),
      targetDate: Date.now() + this.config.planningHorizonDays * 24 * 60 * 60 * 1000,
      region,
      projections,
      actions,
      estimatedCost: actions.reduce((sum, a) => sum + a.estimatedCost, 0),
      estimatedSavings: this.calculateSavings(actions),
      riskLevel: this.assessRisk(projections),
    }

    this.plans.set(plan.id, plan)
    this.emit('plan.created', plan)

    logger.info('Capacity plan generated', {
      planId: plan.id,
      region,
      projections: projections.length,
      actions: actions.length,
      estimatedCost: plan.estimatedCost.toFixed(2),
    })

    return plan
  }

  /**
   * Generate projections
   */
  private generateProjections(region: string): CapacityProjection[] {
    const projections: CapacityProjection[] = []
    const nodes = this.nodeProvider ? this.nodeProvider().filter(n => n.region === region) : []

    // CPU projection
    const cpuHistory = this.metricHistory.get('cpu') || []
    const cpuGrowth = this.calculateGrowthRate(cpuHistory)
    const currentCpu = nodes.length > 0 ? nodes.reduce((s, n) => s + n.cpu, 0) / nodes.length : 50

    projections.push({
      metric: 'cpu',
      currentValue: currentCpu,
      projectedValue: Math.min(100, currentCpu * (1 + cpuGrowth / 100 * 3)), // 3 months
      projectedAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
      unit: '%',
      confidence: 0.8,
      trend: cpuGrowth > 1 ? 'increasing' : cpuGrowth < -1 ? 'decreasing' : 'stable',
      growthRate: cpuGrowth,
    })

    // Memory projection
    const currentMemory = nodes.length > 0 ? nodes.reduce((s, n) => s + n.memory, 0) / nodes.length : 50
    const memoryGrowth = this.calculateGrowthRate(this.metricHistory.get('memory') || [])

    projections.push({
      metric: 'memory',
      currentValue: currentMemory,
      projectedValue: Math.min(100, currentMemory * (1 + memoryGrowth / 100 * 3)),
      projectedAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
      unit: '%',
      confidence: 0.75,
      trend: memoryGrowth > 1 ? 'increasing' : memoryGrowth < -1 ? 'decreasing' : 'stable',
      growthRate: memoryGrowth,
    })

    // Node count projection
    projections.push({
      metric: 'nodes',
      currentValue: nodes.length,
      projectedValue: Math.ceil(nodes.length * (1 + Math.max(cpuGrowth, memoryGrowth) / 100 * 3)),
      projectedAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
      unit: 'count',
      confidence: 0.7,
      trend: 'increasing',
      growthRate: Math.max(cpuGrowth, memoryGrowth),
    })

    return projections
  }

  /**
   * Calculate growth rate (% per month)
   */
  private calculateGrowthRate(history: Array<{ timestamp: number; value: number }>): number {
    if (history.length < 30) return 2 // Default 2% growth

    const recent = history.slice(-30)
    const older = history.slice(-60, -30)

    if (older.length === 0) return 2

    const recentAvg = recent.reduce((s, h) => s + h.value, 0) / recent.length
    const olderAvg = older.reduce((s, h) => s + h.value, 0) / older.length

    return ((recentAvg - olderAvg) / Math.max(olderAvg, 1)) * 100
  }

  /**
   * Generate capacity actions
   */
  private generateActions(projections: CapacityProjection[]): CapacityAction[] {
    const actions: CapacityAction[] = []

    for (const proj of projections) {
      if (proj.metric === 'nodes' && proj.trend === 'increasing') {
        const nodesToAdd = Math.ceil(proj.projectedValue - proj.currentValue)
        if (nodesToAdd > 0) {
          actions.push({
            id: `action-${Date.now()}-${proj.metric}`,
            type: 'scale-up',
            resource: 'nodes',
            currentAmount: proj.currentValue,
            targetAmount: proj.projectedValue,
            unit: 'nodes',
            priority: proj.growthRate > 10 ? 'high' : 'medium',
            estimatedImpact: `Add ${nodesToAdd} nodes to handle projected growth`,
            estimatedCost: nodesToAdd * 50, // $50/node
            executionTime: nodesToAdd * 5 * 60 * 1000,
            status: 'pending',
          })
        }
      }

      if (proj.metric === 'cpu' && proj.projectedValue > this.config.maxUtilization) {
        actions.push({
          id: `action-${Date.now()}-cpu`,
          type: 'optimize',
          resource: 'cpu',
          currentAmount: proj.currentValue,
          targetAmount: this.config.maxUtilization - 10,
          unit: '%',
          priority: 'high',
          estimatedImpact: 'Optimize workloads to reduce CPU pressure',
          estimatedCost: 200,
          executionTime: 30 * 60 * 1000,
          status: 'pending',
        })
      }
    }

    return actions
  }

  /**
   * Calculate potential savings
   */
  private calculateSavings(actions: CapacityAction[]): number {
    // Savings from reserved instances vs on-demand
    const scaleActions = actions.filter(a => a.type === 'scale-up')
    const monthlyCost = scaleActions.reduce((s, a) => s + a.estimatedCost, 0)
    
    // Reserved saves ~30%
    return monthlyCost * 0.3 * 12 // Annual savings
  }

  /**
   * Assess risk level
   */
  private assessRisk(projections: CapacityProjection[]): CapacityPlan['riskLevel'] {
    const maxGrowth = Math.max(...projections.map(p => p.growthRate))
    const maxUtil = Math.max(...projections.filter(p => p.metric !== 'nodes').map(p => p.projectedValue))

    if (maxGrowth > 20 || maxUtil > 90) return 'high'
    if (maxGrowth > 10 || maxUtil > 80) return 'medium'
    return 'low'
  }

  /**
   * Execute capacity action
   */
  async executeAction(action: CapacityAction): Promise<boolean> {
    if (action.status !== 'approved') {
      logger.warn('Action not approved', { actionId: action.id })
      return false
    }

    action.status = 'executing'
    this.emit('action.executed', { actionId: action.id })

    // Simulate execution
    await new Promise(resolve => setTimeout(resolve, 100))

    action.status = 'completed'
    logger.info('Capacity action executed', { actionId: action.id, type: action.type })

    return true
  }

  /**
   * Approve action
   */
  approveAction(planId: string, actionId: string): boolean {
    const plan = this.plans.get(planId)
    if (!plan) return false

    const action = plan.actions.find(a => a.id === actionId)
    if (!action || action.status !== 'pending') return false

    action.status = 'approved'
    this.emit('action.approved', { action, planId })

    return true
  }

  /**
   * Get plan
   */
  getPlan(planId: string): CapacityPlan | undefined {
    return this.plans.get(planId)
  }

  /**
   * Get all plans
   */
  getAllPlans(): CapacityPlan[] {
    return Array.from(this.plans.values()).sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * Get scaling history
   */
  getScalingHistory(limit: number = 100): ScalingEvent[] {
    return Array.from(this.scalingHistory.values())
      .sort((a, b) => b.triggeredAt - a.triggeredAt)
      .slice(0, limit)
  }

  /**
   * Set threshold
   */
  setThreshold(metric: string, threshold: CapacityThreshold): void {
    this.thresholds.set(metric, threshold)
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalPlans: number
    pendingActions: number
    completedActions: number
    scalingEvents: number
    avgGrowthRate: number
  } {
    let pendingActions = 0
    let completedActions = 0
    let totalGrowth = 0
    let growthCount = 0

    for (const plan of this.plans.values()) {
      for (const action of plan.actions) {
        if (action.status === 'pending' || action.status === 'approved') pendingActions++
        if (action.status === 'completed') completedActions++
      }
      for (const proj of plan.projections) {
        totalGrowth += proj.growthRate
        growthCount++
      }
    }

    return {
      totalPlans: this.plans.size,
      pendingActions,
      completedActions,
      scalingEvents: this.scalingHistory.size,
      avgGrowthRate: growthCount > 0 ? totalGrowth / growthCount : 0,
    }
  }

  /**
   * Start periodic planning
   */
  startPlanning(intervalMs: number = 86400000): void {
    this.planningTimer = setInterval(() => {
      const nodes = this.nodeProvider ? this.nodeProvider() : []
      const regions = new Set(nodes.map(n => n.region))
      
      for (const region of regions) {
        this.generatePlan(region)
      }
    }, intervalMs)
  }

  /**
   * Stop planning
   */
  stopPlanning(): void {
    if (this.planningTimer) {
      clearInterval(this.planningTimer)
      this.planningTimer = null
    }
  }

  /**
   * Subscribe to events
   */
  on(event: CapacityEvent, callback: CapacityCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: CapacityEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Capacity planner callback error', error as Error)
      }
    })
  }
}

/**
 * Create capacity planner
 */
export function createCapacityPlanner(config: Partial<CapacityConfig> = {}): CapacityPlanner {
  return new CapacityPlanner(config)
}

// Default instance
export const capacityPlanner = new CapacityPlanner()
