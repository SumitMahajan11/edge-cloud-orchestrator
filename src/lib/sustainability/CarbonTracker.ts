/**
 * Carbon Footprint Tracking
 * Monitor and optimize environmental impact of edge infrastructure
 */

import { logger } from '../logger'
import type { EdgeNode } from '../../types'

// Types
export interface CarbonMetrics {
  timestamp: number
  nodeId?: string
  region: string
  energyKwh: number
  carbonKg: number
  source: 'grid' | 'renewable' | 'mixed'
  renewablePercent: number
  pue: number // Power Usage Effectiveness
  cost: number
}

export interface CarbonBaseline {
  region: string
  gridIntensity: number // gCO2/kWh
  renewableAvailable: number // %
  avgPue: number
  lastUpdated: number
}

export interface CarbonGoal {
  id: string
  name: string
  type: 'reduction' | 'offset' | 'renewable'
  targetValue: number
  targetUnit: string
  targetDate: number
  currentValue: number
  progress: number
  status: 'on-track' | 'at-risk' | 'achieved' | 'failed'
}

export interface CarbonReport {
  id: string
  period: 'daily' | 'weekly' | 'monthly' | 'yearly'
  startDate: number
  endDate: number
  totalEnergyKwh: number
  totalCarbonKg: number
  totalOffsetKg: number
  netCarbonKg: number
  renewablePercent: number
  avgPue: number
  byRegion: Map<string, { energy: number; carbon: number }>
  bySource: Map<string, number>
  recommendations: CarbonRecommendation[]
  comparison: {
    previousPeriod: number
    changePercent: number
  }
}

export interface CarbonRecommendation {
  id: string
  type: 'optimize' | 'migrate' | 'schedule' | 'offset' | 'renewable'
  priority: 'low' | 'medium' | 'high'
  title: string
  description: string
  potentialSavings: number // kg CO2
  costImpact: number
  effort: 'low' | 'medium' | 'high'
  region?: string
  nodeId?: string
}

export interface CarbonConfig {
  reportingInterval: number
  gridIntensityAPI?: string
  defaultPUE: number
  carbonPricePerKg: number
  offsetProvider?: string
}

type CarbonEvent = 'metrics.recorded' | 'goal.progress' | 'report.generated' | 'recommendation.created'
type CarbonCallback = (event: CarbonEvent, data: unknown) => void

// Grid intensity by region (gCO2/kWh) - approximate values
const GRID_INTENSITY: Record<string, number> = {
  'us-east': 350,
  'us-west': 250,
  'eu-west': 200,
  'eu-central': 300,
  'asia-east': 500,
  'asia-southeast': 450,
  'australia': 700,
  'south-america': 300,
}

const DEFAULT_CONFIG: Omit<CarbonConfig, 'gridIntensityAPI' | 'offsetProvider'> = {
  reportingInterval: 3600000, // 1 hour
  defaultPUE: 1.5,
  carbonPricePerKg: 0.05,
}

/**
 * Carbon Footprint Tracker
 */
export class CarbonTracker {
  private config: CarbonConfig
  private metrics: CarbonMetrics[] = []
  private baselines: Map<string, CarbonBaseline> = new Map()
  private goals: Map<string, CarbonGoal> = new Map()
  private reports: Map<string, CarbonReport> = new Map()
  private callbacks: Map<CarbonEvent, Set<CarbonCallback>> = new Map()
  private nodeProvider: (() => EdgeNode[]) | null = null
  private reportingTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: Partial<CarbonConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.initializeBaselines()
  }

  /**
   * Set node provider
   */
  setNodeProvider(provider: () => EdgeNode[]): void {
    this.nodeProvider = provider
  }

  /**
   * Initialize regional baselines
   */
  private initializeBaselines(): void {
    for (const [region, intensity] of Object.entries(GRID_INTENSITY)) {
      this.baselines.set(region, {
        region,
        gridIntensity: intensity,
        renewableAvailable: 20 + Math.random() * 40,
        avgPue: this.config.defaultPUE,
        lastUpdated: Date.now(),
      })
    }
  }

  /**
   * Record carbon metrics
   */
  recordMetrics(metrics: Omit<CarbonMetrics, 'timestamp'> & { timestamp?: number }): void {
    const fullMetrics: CarbonMetrics = {
      ...metrics,
      timestamp: metrics.timestamp || Date.now(),
    }

    this.metrics.push(fullMetrics)

    // Update goals
    this.updateGoalProgress(fullMetrics)

    this.emit('metrics.recorded', fullMetrics)
    logger.debug('Carbon metrics recorded', {
      region: metrics.region,
      energy: metrics.energyKwh.toFixed(2),
      carbon: metrics.carbonKg.toFixed(2),
    })
  }

  /**
   * Calculate carbon for energy consumption
   */
  calculateCarbon(energyKwh: number, region: string): number {
    const baseline = this.baselines.get(region)
    const gridIntensity = baseline?.gridIntensity || 400 // gCO2/kWh
    
    // Adjust for renewable percentage
    const renewableFactor = (100 - (baseline?.renewableAvailable || 0)) / 100
    
    // Convert to kg CO2
    return (energyKwh * gridIntensity * renewableFactor) / 1000
  }

  /**
   * Calculate node energy consumption
   */
  calculateNodeEnergy(node: EdgeNode, durationHours: number = 1): number {
    // Estimate power consumption based on utilization
    // Typical edge server: 200-500W at full load
    const basePower = 200 // Watts
    const maxPower = 500 // Watts
    
    const utilization = (node.cpu + node.memory) / 200 // Average utilization
    const power = basePower + (maxPower - basePower) * utilization
    
    // Apply PUE
    const pue = this.config.defaultPUE
    
    return (power * pue * durationHours) / 1000 // kWh
  }

  /**
   * Collect metrics from all nodes
   */
  async collectMetrics(): Promise<CarbonMetrics[]> {
    const nodes = this.nodeProvider ? this.nodeProvider() : []
    const collected: CarbonMetrics[] = []

    for (const node of nodes) {
      if (node.status !== 'online') continue

      const baseline = this.baselines.get(node.region) || this.baselines.values().next().value
      const energyKwh = this.calculateNodeEnergy(node)
      const carbonKg = this.calculateCarbon(energyKwh, node.region)
      const renewableAvailable = baseline?.renewableAvailable || 0
      const avgPue = baseline?.avgPue || this.config.defaultPUE

      const metrics: CarbonMetrics = {
        timestamp: Date.now(),
        nodeId: node.id,
        region: node.region,
        energyKwh,
        carbonKg,
        source: renewableAvailable > 50 ? 'renewable' : renewableAvailable > 20 ? 'mixed' : 'grid',
        renewablePercent: renewableAvailable,
        pue: avgPue,
        cost: carbonKg * this.config.carbonPricePerKg,
      }

      this.recordMetrics(metrics)
      collected.push(metrics)
    }

    return collected
  }

  /**
   * Generate carbon report
   */
  generateReport(period: CarbonReport['period']): CarbonReport {
    const now = Date.now()
    const periodMs: Record<string, number> = {
      daily: 86400000,
      weekly: 604800000,
      monthly: 2592000000,
      yearly: 31536000000,
    }

    const startDate = now - periodMs[period]
    const periodMetrics = this.metrics.filter(m => m.timestamp >= startDate)

    let totalEnergy = 0
    let totalCarbon = 0
    let totalRenewable = 0
    let totalPue = 0
    const byRegion = new Map<string, { energy: number; carbon: number }>()
    const bySource = new Map<string, number>()

    for (const m of periodMetrics) {
      totalEnergy += m.energyKwh
      totalCarbon += m.carbonKg
      totalRenewable += m.renewablePercent * m.energyKwh
      totalPue += m.pue

      const region = byRegion.get(m.region) || { energy: 0, carbon: 0 }
      region.energy += m.energyKwh
      region.carbon += m.carbonKg
      byRegion.set(m.region, region)

      bySource.set(m.source, (bySource.get(m.source) || 0) + m.carbonKg)
    }

    const avgRenewable = totalEnergy > 0 ? totalRenewable / totalEnergy : 0
    const avgPue = periodMetrics.length > 0 ? totalPue / periodMetrics.length : this.config.defaultPUE

    // Compare with previous period
    const previousMetrics = this.metrics.filter(m => 
      m.timestamp >= startDate - periodMs[period] && m.timestamp < startDate
    )
    const previousCarbon = previousMetrics.reduce((s, m) => s + m.carbonKg, 0)
    const changePercent = previousCarbon > 0 
      ? ((totalCarbon - previousCarbon) / previousCarbon) * 100 
      : 0

    const report: CarbonReport = {
      id: `report-${period}-${Date.now()}`,
      period,
      startDate,
      endDate: now,
      totalEnergyKwh: totalEnergy,
      totalCarbonKg: totalCarbon,
      totalOffsetKg: 0, // Would track offsets
      netCarbonKg: totalCarbon,
      renewablePercent: avgRenewable,
      avgPue,
      byRegion,
      bySource,
      recommendations: this.generateRecommendations(periodMetrics),
      comparison: {
        previousPeriod: previousCarbon,
        changePercent,
      },
    }

    this.reports.set(report.id, report)
    this.emit('report.generated', report)

    logger.info('Carbon report generated', {
      period,
      totalCarbon: totalCarbon.toFixed(2),
      renewablePercent: avgRenewable.toFixed(1),
      changePercent: changePercent.toFixed(1),
    })

    return report
  }

  /**
   * Generate carbon reduction recommendations
   */
  private generateRecommendations(metrics: CarbonMetrics[]): CarbonRecommendation[] {
    const recommendations: CarbonRecommendation[] = []

    // Group by region
    const byRegion = new Map<string, CarbonMetrics[]>()
    for (const m of metrics) {
      const region = byRegion.get(m.region) || []
      region.push(m)
      byRegion.set(m.region, region)
    }

    // Find high-carbon regions
    for (const [region, regionMetrics] of byRegion) {
      const totalCarbon = regionMetrics.reduce((s, m) => s + m.carbonKg, 0)
      const avgRenewable = regionMetrics.reduce((s, m) => s + m.renewablePercent, 0) / regionMetrics.length

      if (avgRenewable < 30) {
        recommendations.push({
          id: `rec-${Date.now()}-${region}-renewable`,
          type: 'renewable',
          priority: 'high',
          title: `Increase Renewable Energy in ${region}`,
          description: `Region has only ${avgRenewable.toFixed(0)}% renewable energy. Consider purchasing renewable credits or migrating workloads.`,
          potentialSavings: totalCarbon * 0.5,
          costImpact: -100, // Cost savings
          effort: 'medium',
          region,
        })
      }

      // Compare with cleaner regions
      const baseline = this.baselines.get(region)
      if (baseline && baseline.gridIntensity > 400) {
        const cleanerRegions = Array.from(this.baselines.values())
          .filter(b => b.gridIntensity < baseline.gridIntensity * 0.7)
        
        if (cleanerRegions.length > 0) {
          recommendations.push({
            id: `rec-${Date.now()}-${region}-migrate`,
            type: 'migrate',
            priority: 'medium',
            title: `Migrate Workloads from ${region}`,
            description: `Consider migrating workloads to ${cleanerRegions[0].region} which has ${cleanerRegions[0].gridIntensity} gCO2/kWh vs ${baseline.gridIntensity} gCO2/kWh`,
            potentialSavings: totalCarbon * 0.3,
            costImpact: 200, // Migration cost
            effort: 'high',
            region,
          })
        }
      }
    }

    // PUE optimization
    const avgPue = metrics.reduce((s, m) => s + m.pue, 0) / metrics.length
    if (avgPue > 1.4) {
      recommendations.push({
        id: `rec-${Date.now()}-pue`,
        type: 'optimize',
        priority: 'medium',
        title: 'Improve Data Center Efficiency',
        description: `Average PUE of ${avgPue.toFixed(2)} can be improved through better cooling and power management.`,
        potentialSavings: metrics.reduce((s, m) => s + m.carbonKg, 0) * 0.15,
        costImpact: 5000, // Infrastructure investment
        effort: 'high',
      })
    }

    // Scheduling optimization
    recommendations.push({
      id: `rec-${Date.now()}-schedule`,
      type: 'schedule',
      priority: 'low',
      title: 'Optimize Workload Scheduling',
      description: 'Schedule high-energy workloads during times of higher renewable energy availability.',
      potentialSavings: metrics.reduce((s, m) => s + m.carbonKg, 0) * 0.1,
      costImpact: 0,
      effort: 'low',
    })

    for (const rec of recommendations) {
      this.emit('recommendation.created', rec)
    }

    return recommendations
  }

  /**
   * Create carbon reduction goal
   */
  createGoal(goal: Omit<CarbonGoal, 'id' | 'currentValue' | 'progress' | 'status'>): CarbonGoal {
    const fullGoal: CarbonGoal = {
      ...goal,
      id: `goal-${Date.now()}`,
      currentValue: 0,
      progress: 0,
      status: 'on-track',
    }

    this.goals.set(fullGoal.id, fullGoal)
    return fullGoal
  }

  /**
   * Update goal progress
   */
  private updateGoalProgress(metrics: CarbonMetrics): void {
    for (const goal of this.goals.values()) {
      if (goal.type === 'reduction') {
        goal.currentValue += metrics.carbonKg
        goal.progress = Math.min(100, (1 - goal.currentValue / goal.targetValue) * 100)
      } else if (goal.type === 'renewable') {
        goal.currentValue = metrics.renewablePercent
        goal.progress = (goal.currentValue / goal.targetValue) * 100
      }

      // Update status
      const timeProgress = (Date.now() - (goal.targetDate - 365 * 24 * 60 * 60 * 1000)) / 
                          (goal.targetDate - (goal.targetDate - 365 * 24 * 60 * 60 * 1000))
      
      if (goal.progress >= 100) {
        goal.status = 'achieved'
      } else if (goal.progress / 100 < timeProgress * 0.8) {
        goal.status = 'at-risk'
      }

      this.emit('goal.progress', goal)
    }
  }

  /**
   * Get carbon summary
   */
  getSummary(): {
    totalCarbonKg: number
    totalEnergyKwh: number
    avgRenewablePercent: number
    avgPue: number
    byRegion: Record<string, { energy: number; carbon: number }>
  } {
    const last24h = this.metrics.filter(m => m.timestamp > Date.now() - 86400000)
    
    let totalCarbon = 0
    let totalEnergy = 0
    let totalRenewable = 0
    let totalPue = 0
    const byRegion: Record<string, { energy: number; carbon: number }> = {}

    for (const m of last24h) {
      totalCarbon += m.carbonKg
      totalEnergy += m.energyKwh
      totalRenewable += m.renewablePercent
      totalPue += m.pue

      if (!byRegion[m.region]) {
        byRegion[m.region] = { energy: 0, carbon: 0 }
      }
      byRegion[m.region].energy += m.energyKwh
      byRegion[m.region].carbon += m.carbonKg
    }

    return {
      totalCarbonKg: totalCarbon,
      totalEnergyKwh: totalEnergy,
      avgRenewablePercent: last24h.length > 0 ? totalRenewable / last24h.length : 0,
      avgPue: last24h.length > 0 ? totalPue / last24h.length : this.config.defaultPUE,
      byRegion,
    }
  }

  /**
   * Get goals
   */
  getGoals(): CarbonGoal[] {
    return Array.from(this.goals.values())
  }

  /**
   * Get reports
   */
  getReports(): CarbonReport[] {
    return Array.from(this.reports.values()).sort((a, b) => b.endDate - a.endDate)
  }

  /**
   * Start periodic reporting
   */
  startReporting(): void {
    this.reportingTimer = setInterval(() => {
      this.collectMetrics()
    }, this.config.reportingInterval)
  }

  /**
   * Stop reporting
   */
  stopReporting(): void {
    if (this.reportingTimer) {
      clearInterval(this.reportingTimer)
      this.reportingTimer = null
    }
  }

  /**
   * Subscribe to events
   */
  on(event: CarbonEvent, callback: CarbonCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: CarbonEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Carbon tracker callback error', error as Error)
      }
    })
  }
}

/**
 * Create carbon tracker
 */
export function createCarbonTracker(config: Partial<CarbonConfig> = {}): CarbonTracker {
  return new CarbonTracker(config)
}

// Default instance
export const carbonTracker = new CarbonTracker()
