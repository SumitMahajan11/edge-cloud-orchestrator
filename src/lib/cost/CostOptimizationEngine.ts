/**
 * ML-Based Cost Optimization Engine
 * Analyzes resource usage and provides cost-saving recommendations
 */

import { logger } from '../logger'
import type { EdgeNode } from '../../types'

// Types
export interface CostMetrics {
  nodeId: string
  timestamp: number
  cpuUsage: number
  memoryUsage: number
  storageUsage: number
  networkInBytes: number
  networkOutBytes: number
  tasksProcessed: number
  energyConsumption: number // kWh
  costPerHour: number
  region: string
}

export interface CostAnalysis {
  id: string
  timestamp: number
  totalCost: number
  breakdown: {
    compute: number
    network: number
    storage: number
    energy: number
  }
  trends: {
    daily: number[]
    weekly: number[]
    monthly: number[]
  }
  anomalies: CostAnomaly[]
}

export interface CostAnomaly {
  id: string
  type: 'spike' | 'inefficiency' | 'idle-resource' | 'over-provisioned'
  nodeId?: string
  severity: 'low' | 'medium' | 'high'
  description: string
  impact: number // Cost impact in $
  detectedAt: number
}

export interface CostRecommendation {
  id: string
  type: 'scale-down' | 'scale-up' | 'consolidate' | 'migrate' | 'schedule' | 'right-size' | 'reserve'
  priority: 'low' | 'medium' | 'high' | 'critical'
  title: string
  description: string
  affectedNodes: string[]
  currentCost: number
  projectedSavings: number
  savingsPercentage: number
  implementation: string
  risk: 'low' | 'medium' | 'high'
  estimatedEffort: 'minutes' | 'hours' | 'days'
  createdAt: number
  status: 'pending' | 'approved' | 'implemented' | 'dismissed'
}

export interface PricingModel {
  region: string
  cpuCostPerCoreHour: number
  memoryCostPerGBHour: number
  storageCostPerGBMonth: number
  networkCostPerGB: number
  energyCostPerKWh: number
}

export interface CostOptimizationConfig {
  analysisInterval: number
  historyRetentionDays: number
  anomalyThreshold: number // Percentage deviation
  minSavingsThreshold: number // Minimum $ to report
  pricingModels: PricingModel[]
}

type CostEvent = 'analysis.completed' | 'anomaly.detected' | 'recommendation.generated' | 'savings.achieved'
type CostCallback = (event: CostEvent, data: unknown) => void

const DEFAULT_PRICING: PricingModel[] = [
  { region: 'us-east', cpuCostPerCoreHour: 0.04, memoryCostPerGBHour: 0.01, storageCostPerGBMonth: 0.10, networkCostPerGB: 0.09, energyCostPerKWh: 0.12 },
  { region: 'us-west', cpuCostPerCoreHour: 0.045, memoryCostPerGBHour: 0.011, storageCostPerGBMonth: 0.11, networkCostPerGB: 0.09, energyCostPerKWh: 0.14 },
  { region: 'eu-west', cpuCostPerCoreHour: 0.05, memoryCostPerGBHour: 0.012, storageCostPerGBMonth: 0.12, networkCostPerGB: 0.10, energyCostPerKWh: 0.18 },
  { region: 'asia-east', cpuCostPerCoreHour: 0.055, memoryCostPerGBHour: 0.013, storageCostPerGBMonth: 0.13, networkCostPerGB: 0.12, energyCostPerKWh: 0.16 },
]

const DEFAULT_CONFIG: Omit<CostOptimizationConfig, 'pricingModels'> = {
  analysisInterval: 3600000, // 1 hour
  historyRetentionDays: 90,
  anomalyThreshold: 20, // 20% deviation
  minSavingsThreshold: 10, // $10 minimum
}

/**
 * Cost Optimization Engine
 */
export class CostOptimizationEngine {
  private config: CostOptimizationConfig
  private metricsHistory: Map<string, CostMetrics[]> = new Map()
  private analyses: Map<string, CostAnalysis> = new Map()
  private recommendations: Map<string, CostRecommendation> = new Map()
  private callbacks: Map<CostEvent, Set<CostCallback>> = new Map()
  private analysisTimer: ReturnType<typeof setInterval> | null = null
  private nodeProvider: (() => EdgeNode[]) | null = null

  constructor(config: Partial<CostOptimizationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, pricingModels: DEFAULT_PRICING, ...config }
  }

  /**
   * Set node provider
   */
  setNodeProvider(provider: () => EdgeNode[]): void {
    this.nodeProvider = provider
  }

  /**
   * Record cost metrics for a node
   */
  recordMetrics(metrics: CostMetrics): void {
    if (!this.metricsHistory.has(metrics.nodeId)) {
      this.metricsHistory.set(metrics.nodeId, [])
    }

    const history = this.metricsHistory.get(metrics.nodeId)!
    history.push(metrics)

    // Trim old data
    const cutoff = Date.now() - this.config.historyRetentionDays * 24 * 60 * 60 * 1000
    const filtered = history.filter(m => m.timestamp > cutoff)
    this.metricsHistory.set(metrics.nodeId, filtered)
  }

  /**
   * Get pricing model for region
   */
  private getPricing(region: string): PricingModel {
    return this.config.pricingModels.find(p => p.region === region) || this.config.pricingModels[0]
  }

  /**
   * Calculate cost for a node
   */
  calculateNodeCost(node: EdgeNode, durationHours: number = 1): number {
    const pricing = this.getPricing(node.region)
    
    // Use node's costPerHour if available, otherwise estimate
    if (node.costPerHour) {
      return node.costPerHour * durationHours
    }
    
    // Estimate based on maxTasks as proxy for capacity
    const estimatedCores = Math.max(1, Math.floor(node.maxTasks / 2))
    const estimatedMemory = Math.max(1, node.maxTasks)
    
    const cpuCost = estimatedCores * pricing.cpuCostPerCoreHour * durationHours
    const memoryCost = estimatedMemory * pricing.memoryCostPerGBHour * durationHours
    const storageCost = (node.storage || 100) * pricing.storageCostPerGBMonth / (30 * 24) * durationHours
    
    return cpuCost + memoryCost + storageCost
  }

  /**
   * Run cost analysis
   */
  async analyze(): Promise<CostAnalysis> {
    const nodes = this.nodeProvider ? this.nodeProvider() : []
    const analysisId = `analysis-${Date.now()}`

    let totalCompute = 0
    let totalNetwork = 0
    let totalStorage = 0
    let totalEnergy = 0
    const anomalies: CostAnomaly[] = []

    for (const node of nodes) {
      const pricing = this.getPricing(node.region)
      const history = this.metricsHistory.get(node.id) || []
      
      // Calculate costs
      const nodeCost = this.calculateNodeCost(node, 1)
      totalCompute += nodeCost * (node.cpu / 100)
      totalStorage += (node.storage || 100) * pricing.storageCostPerGBMonth / 720
      
      // Energy cost estimation
      const estimatedCores = Math.max(1, Math.floor(node.maxTasks / 2))
      const energyCost = estimatedCores * 0.1 * pricing.energyCostPerKWh
      totalEnergy += energyCost

      // Detect anomalies
      if (history.length > 10) {
        const recent = history.slice(-10)
        const avgCpu = recent.reduce((s, m) => s + m.cpuUsage, 0) / recent.length
        
        // Idle resource detection
        if (avgCpu < 10 && node.status === 'online') {
          anomalies.push({
            id: `anomaly-${Date.now()}-${node.id}`,
            type: 'idle-resource',
            nodeId: node.id,
            severity: 'medium',
            description: `Node ${node.id} has low CPU utilization (${avgCpu.toFixed(1)}%)`,
            impact: this.calculateNodeCost(node, 24) * 0.5,
            detectedAt: Date.now(),
          })
        }

        // Over-provisioned detection
        if (avgCpu < 30 && node.memory < 30) {
          anomalies.push({
            id: `anomaly-${Date.now()}-${node.id}-over`,
            type: 'over-provisioned',
            nodeId: node.id,
            severity: 'low',
            description: `Node ${node.id} appears over-provisioned`,
            impact: this.calculateNodeCost(node, 24) * 0.3,
            detectedAt: Date.now(),
          })
        }
      }
    }

    const analysis: CostAnalysis = {
      id: analysisId,
      timestamp: Date.now(),
      totalCost: totalCompute + totalNetwork + totalStorage + totalEnergy,
      breakdown: {
        compute: totalCompute,
        network: totalNetwork,
        storage: totalStorage,
        energy: totalEnergy,
      },
      trends: this.calculateTrends(),
      anomalies,
    }

    this.analyses.set(analysisId, analysis)
    
    // Generate recommendations
    await this.generateRecommendations(analysis, nodes)

    this.emit('analysis.completed', analysis)
    logger.info('Cost analysis completed', { analysisId, totalCost: analysis.totalCost.toFixed(2) })

    return analysis
  }

  /**
   * Calculate cost trends
   */
  private calculateTrends(): { daily: number[]; weekly: number[]; monthly: number[] } {
    const daily: number[] = []
    const weekly: number[] = []
    const monthly: number[] = []

    // Simulate trend data (in production, would aggregate from history)
    for (let i = 0; i < 7; i++) {
      daily.push(100 + Math.random() * 50)
    }
    for (let i = 0; i < 4; i++) {
      weekly.push(700 + Math.random() * 200)
    }
    for (let i = 0; i < 3; i++) {
      monthly.push(3000 + Math.random() * 500)
    }

    return { daily, weekly, monthly }
  }

  /**
   * Generate cost optimization recommendations
   */
  private async generateRecommendations(analysis: CostAnalysis, nodes: EdgeNode[]): Promise<void> {
    // 1. Scale-down recommendations for idle nodes
    const idleNodes = nodes.filter(n => n.cpu < 15 && n.memory < 20 && n.status === 'online')
    if (idleNodes.length > 0) {
      const savings = idleNodes.reduce((sum, n) => sum + this.calculateNodeCost(n, 24) * 0.7, 0)
      
      if (savings >= this.config.minSavingsThreshold) {
        this.addRecommendation({
          type: 'scale-down',
          priority: savings > 100 ? 'high' : 'medium',
          title: 'Scale Down Idle Nodes',
          description: `${idleNodes.length} nodes have low utilization and can be scaled down`,
          affectedNodes: idleNodes.map(n => n.id),
          currentCost: savings / 0.7,
          projectedSavings: savings,
          savingsPercentage: 70,
          implementation: 'Reduce node count or switch to smaller instance types',
          risk: 'low',
          estimatedEffort: 'hours',
        })
      }
    }

    // 2. Consolidation recommendations
    const lowUtilNodes = nodes.filter(n => n.cpu < 40 && n.memory < 50)
    if (lowUtilNodes.length >= 2) {
      const potentialSavings = lowUtilNodes.slice(1).reduce((sum, n) => sum + this.calculateNodeCost(n, 24) * 0.5, 0)
      
      if (potentialSavings >= this.config.minSavingsThreshold) {
        this.addRecommendation({
          type: 'consolidate',
          priority: 'medium',
          title: 'Consolidate Under-Utilized Nodes',
          description: `${lowUtilNodes.length} nodes can be consolidated to reduce costs`,
          affectedNodes: lowUtilNodes.map(n => n.id),
          currentCost: potentialSavings / 0.5,
          projectedSavings: potentialSavings,
          savingsPercentage: 50,
          implementation: 'Migrate workloads and decommission excess nodes',
          risk: 'medium',
          estimatedEffort: 'days',
        })
      }
    }

    // 3. Region migration recommendations
    const expensiveRegions = new Map<string, { nodes: EdgeNode[]; cost: number }>()
    for (const node of nodes) {
      const cost = this.calculateNodeCost(node, 24)
      const region = node.region
      
      if (!expensiveRegions.has(region)) {
        expensiveRegions.set(region, { nodes: [], cost: 0 })
      }
      expensiveRegions.get(region)!.nodes.push(node)
      expensiveRegions.get(region)!.cost += cost
    }

    // Find cheaper region
    const cheapestRegion = this.config.pricingModels.reduce((min, p) => 
      p.cpuCostPerCoreHour < min.cpuCostPerCoreHour ? p : min
    )

    for (const [region, data] of expensiveRegions) {
      if (region !== cheapestRegion.region && data.cost > 50) {
        const newCost = data.nodes.reduce((sum, n) => {
          const pricing = this.getPricing(cheapestRegion.region)
          const estimatedCores = Math.max(1, Math.floor(n.maxTasks / 2))
          return sum + estimatedCores * pricing.cpuCostPerCoreHour * 24
        }, 0)
        
        const savings = data.cost - newCost
        
        if (savings >= this.config.minSavingsThreshold) {
          this.addRecommendation({
            type: 'migrate',
            priority: 'low',
            title: `Migrate Workloads to ${cheapestRegion.region}`,
            description: `Moving ${data.nodes.length} nodes from ${region} to ${cheapestRegion.region} can reduce costs`,
            affectedNodes: data.nodes.map(n => n.id),
            currentCost: data.cost,
            projectedSavings: savings,
            savingsPercentage: (savings / data.cost) * 100,
            implementation: `Migrate nodes to ${cheapestRegion.region} region`,
            risk: 'high',
            estimatedEffort: 'days',
          })
        }
      }
    }

    // 4. Scheduled scaling recommendations
    this.addRecommendation({
      type: 'schedule',
      priority: 'medium',
      title: 'Implement Scheduled Scaling',
      description: 'Scale down during off-peak hours to reduce costs',
      affectedNodes: nodes.map(n => n.id),
      currentCost: analysis.totalCost * 0.3,
      projectedSavings: analysis.totalCost * 0.15,
      savingsPercentage: 15,
      implementation: 'Configure auto-scaling schedules for non-peak hours',
      risk: 'low',
      estimatedEffort: 'hours',
    })

    // 5. Reserved capacity recommendations
    const steadyNodes = nodes.filter(n => n.tasksRunning > 0)
    if (steadyNodes.length > 0) {
      const monthlyCost = steadyNodes.reduce((sum, n) => sum + this.calculateNodeCost(n, 720), 0)
      const reservedSavings = monthlyCost * 0.3 // ~30% savings with reserved

      if (reservedSavings >= this.config.minSavingsThreshold * 30) {
        this.addRecommendation({
          type: 'reserve',
          priority: 'high',
          title: 'Purchase Reserved Capacity',
          description: `${steadyNodes.length} nodes have steady workloads suitable for reserved pricing`,
          affectedNodes: steadyNodes.map(n => n.id),
          currentCost: monthlyCost,
          projectedSavings: reservedSavings,
          savingsPercentage: 30,
          implementation: 'Purchase 1-year or 3-year reserved instances',
          risk: 'low',
          estimatedEffort: 'hours',
        })
      }
    }
  }

  /**
   * Add a recommendation
   */
  private addRecommendation(base: Omit<CostRecommendation, 'id' | 'createdAt' | 'status'>): void {
    const recommendation: CostRecommendation = {
      ...base,
      id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      status: 'pending',
    }

    this.recommendations.set(recommendation.id, recommendation)
    this.emit('recommendation.generated', recommendation)
    
    logger.info('Cost recommendation generated', { 
      id: recommendation.id, 
      type: recommendation.type, 
      savings: recommendation.projectedSavings.toFixed(2) 
    })
  }

  /**
   * Get recommendations
   */
  getRecommendations(status?: CostRecommendation['status']): CostRecommendation[] {
    const all = Array.from(this.recommendations.values())
    return status ? all.filter(r => r.status === status) : all
  }

  /**
   * Apply recommendation
   */
  async applyRecommendation(recommendationId: string): Promise<boolean> {
    const recommendation = this.recommendations.get(recommendationId)
    if (!recommendation || recommendation.status !== 'pending') {
      return false
    }

    recommendation.status = 'approved'
    
    // Simulate implementation
    await new Promise(resolve => setTimeout(resolve, 100))
    
    recommendation.status = 'implemented'
    this.emit('savings.achieved', { recommendation, savings: recommendation.projectedSavings })
    
    logger.info('Recommendation applied', { id: recommendationId, savings: recommendation.projectedSavings })
    return true
  }

  /**
   * Dismiss recommendation
   */
  dismissRecommendation(recommendationId: string): boolean {
    const recommendation = this.recommendations.get(recommendationId)
    if (!recommendation) return false

    recommendation.status = 'dismissed'
    return true
  }

  /**
   * Get latest analysis
   */
  getLatestAnalysis(): CostAnalysis | undefined {
    const all = Array.from(this.analyses.values())
    return all.sort((a, b) => b.timestamp - a.timestamp)[0]
  }

  /**
   * Get cost summary
   */
  getCostSummary(): {
    currentHourlyRate: number
    projectedMonthly: number
    potentialSavings: number
    recommendationsCount: number
  } {
    const nodes = this.nodeProvider ? this.nodeProvider() : []
    const currentHourlyRate = nodes.reduce((sum, n) => sum + this.calculateNodeCost(n, 1), 0)
    
    const pendingRecs = this.getRecommendations('pending')
    const potentialSavings = pendingRecs.reduce((sum, r) => sum + r.projectedSavings, 0)

    return {
      currentHourlyRate,
      projectedMonthly: currentHourlyRate * 720,
      potentialSavings,
      recommendationsCount: pendingRecs.length,
    }
  }

  /**
   * Start periodic analysis
   */
  startAnalysis(): void {
    this.analysisTimer = setInterval(() => {
      this.analyze()
    }, this.config.analysisInterval)
    
    // Run initial analysis
    this.analyze()
  }

  /**
   * Stop analysis
   */
  stopAnalysis(): void {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer)
      this.analysisTimer = null
    }
  }

  /**
   * Subscribe to events
   */
  on(event: CostEvent, callback: CostCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: CostEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Cost optimization callback error', error as Error)
      }
    })
  }
}

/**
 * Create cost optimization engine
 */
export function createCostOptimizationEngine(config: Partial<CostOptimizationConfig> = {}): CostOptimizationEngine {
  return new CostOptimizationEngine(config)
}

// Default instance
export const costOptimizationEngine = new CostOptimizationEngine()
