/**
 * Blue-Green Deployment Manager for Edge Agents
 * Zero-downtime deployments with automatic rollback
 */

import { logger } from '../logger'
import type { EdgeNode } from '../../types'

// Types
export interface DeploymentConfig {
  name: string
  version: string
  artifactUrl: string
  checksum: string
  environment: Record<string, string>
  healthCheckEndpoint: string
  healthCheckInterval: number
  healthCheckTimeout: number
  minHealthyNodes: number
  rolloutStrategy: 'rolling' | 'blue-green' | 'canary'
  rolloutPercentage: number
  rollbackOnFailure: boolean
  rollbackThreshold: number // Error rate percentage
}

export interface DeploymentSlot {
  name: 'blue' | 'green'
  version: string
  nodes: Set<string>
  status: 'active' | 'idle' | 'deploying' | 'draining' | 'failed'
  createdAt: number
  healthScore: number
  requestCount: number
  errorCount: number
}

export interface DeploymentRecord {
  id: string
  config: DeploymentConfig
  status: 'pending' | 'deploying' | 'validating' | 'active' | 'rolling-back' | 'completed' | 'failed'
  blueSlot: DeploymentSlot
  greenSlot: DeploymentSlot
  activeSlot: 'blue' | 'green'
  startTime: number
  endTime?: number
  progress: number
  error?: string
  metrics: {
    nodesDeployed: number
    nodesHealthy: number
    nodesFailed: number
    trafficShifted: number
  }
}

export interface TrafficSplit {
  bluePercentage: number
  greenPercentage: number
  lastUpdated: number
}

type DeploymentEvent = 'deployment.started' | 'deployment.progress' | 'deployment.completed' | 'deployment.failed' | 'traffic.shifted' | 'rollback.triggered'
type DeploymentCallback = (event: DeploymentEvent, data: unknown) => void

/**
 * Blue-Green Deployment Manager
 */
export class BlueGreenDeploymentManager {
  private deployments: Map<string, DeploymentRecord> = new Map()
  private activeDeployment: DeploymentRecord | null = null
  private trafficSplit: TrafficSplit = { bluePercentage: 100, greenPercentage: 0, lastUpdated: Date.now() }
  private callbacks: Map<DeploymentEvent, Set<DeploymentCallback>> = new Map()
  private nodeProvider: (() => EdgeNode[]) | null = null
  private healthChecker: ((nodeId: string, endpoint: string) => Promise<boolean>) | null = null

  /**
   * Set node provider
   */
  setNodeProvider(provider: () => EdgeNode[]): void {
    this.nodeProvider = provider
  }

  /**
   * Set health checker
   */
  setHealthChecker(checker: (nodeId: string, endpoint: string) => Promise<boolean>): void {
    this.healthChecker = checker
  }

  /**
   * Start a new deployment
   */
  async startDeployment(config: DeploymentConfig): Promise<DeploymentRecord> {
    if (this.activeDeployment && this.activeDeployment.status === 'deploying') {
      throw new Error('Another deployment is in progress')
    }

    const deploymentId = `deploy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Determine target slot (opposite of active)
    const targetSlot: 'blue' | 'green' = this.trafficSplit.bluePercentage >= 50 ? 'green' : 'blue'
    const idleSlot: 'blue' | 'green' = targetSlot === 'blue' ? 'green' : 'blue'

    const deployment: DeploymentRecord = {
      id: deploymentId,
      config,
      status: 'pending',
      blueSlot: {
        name: 'blue',
        version: targetSlot === 'blue' ? config.version : 'previous',
        nodes: new Set(),
        status: targetSlot === 'blue' ? 'deploying' : (this.trafficSplit.bluePercentage > 0 ? 'active' : 'idle'),
        createdAt: Date.now(),
        healthScore: 100,
        requestCount: 0,
        errorCount: 0,
      },
      greenSlot: {
        name: 'green',
        version: targetSlot === 'green' ? config.version : 'previous',
        nodes: new Set(),
        status: targetSlot === 'green' ? 'deploying' : (this.trafficSplit.greenPercentage > 0 ? 'active' : 'idle'),
        createdAt: Date.now(),
        healthScore: 100,
        requestCount: 0,
        errorCount: 0,
      },
      activeSlot: idleSlot,
      startTime: Date.now(),
      progress: 0,
      metrics: { nodesDeployed: 0, nodesHealthy: 0, nodesFailed: 0, trafficShifted: 0 },
    }

    this.deployments.set(deploymentId, deployment)
    this.activeDeployment = deployment

    this.emit('deployment.started', { deploymentId, config, targetSlot })
    logger.info('Deployment started', { deploymentId, version: config.version, targetSlot })

    // Execute deployment
    await this.executeDeployment(deployment, targetSlot)

    return deployment
  }

  /**
   * Execute deployment process
   */
  private async executeDeployment(deployment: DeploymentRecord, targetSlot: 'blue' | 'green'): Promise<void> {
    const slot = targetSlot === 'blue' ? deployment.blueSlot : deployment.greenSlot

    try {
      deployment.status = 'deploying'

      // Get nodes for deployment
      const nodes = this.nodeProvider ? this.nodeProvider().filter(n => n.status === 'online') : []
      
      if (nodes.length === 0) {
        throw new Error('No online nodes available for deployment')
      }

      // Phase 1: Deploy to target slot
      deployment.progress = 10
      this.emit('deployment.progress', { deploymentId: deployment.id, progress: 10, phase: 'deploying' })

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        
        // Simulate deployment to node
        const success = await this.deployToNode(node, deployment.config)
        
        if (success) {
          slot.nodes.add(node.id)
          deployment.metrics.nodesDeployed++
        } else {
          deployment.metrics.nodesFailed++
        }

        deployment.progress = 10 + Math.floor((i / nodes.length) * 40)
        this.emit('deployment.progress', { deploymentId: deployment.id, progress: deployment.progress })
      }

      // Phase 2: Health check validation
      deployment.status = 'validating'
      deployment.progress = 50
      this.emit('deployment.progress', { deploymentId: deployment.id, progress: 50, phase: 'validating' })

      const healthyNodes = await this.validateHealth(slot, deployment.config)
      deployment.metrics.nodesHealthy = healthyNodes

      if (healthyNodes < deployment.config.minHealthyNodes) {
        throw new Error(`Insufficient healthy nodes: ${healthyNodes} < ${deployment.config.minHealthyNodes}`)
      }

      // Phase 3: Traffic shift
      deployment.progress = 70
      this.emit('deployment.progress', { deploymentId: deployment.id, progress: 70, phase: 'traffic-shifting' })

      await this.shiftTraffic(targetSlot, deployment.config.rolloutPercentage / 100)

      // Phase 4: Monitor for rollback
      deployment.progress = 80
      this.emit('deployment.progress', { deploymentId: deployment.id, progress: 80, phase: 'monitoring' })

      if (deployment.config.rollbackOnFailure) {
        await this.monitorForRollback(deployment, slot)
      }

      // Complete
      deployment.status = 'active'
      deployment.progress = 100
      deployment.endTime = Date.now()
      deployment.activeSlot = targetSlot
      slot.status = 'active'

      this.emit('deployment.completed', deployment)
      logger.info('Deployment completed', { deploymentId: deployment.id, version: deployment.config.version })

    } catch (error) {
      deployment.status = 'failed'
      deployment.error = (error as Error).message
      deployment.endTime = Date.now()
      slot.status = 'failed'

      if (deployment.config.rollbackOnFailure) {
        await this.rollback(deployment)
      }

      this.emit('deployment.failed', { deploymentId: deployment.id, error: deployment.error })
      logger.error('Deployment failed', error as Error, { deploymentId: deployment.id })
    }
  }

  /**
   * Deploy to a single node
   */
  private async deployToNode(node: EdgeNode, config: DeploymentConfig): Promise<boolean> {
    // Simulate deployment (in production, would use SSH/Docker API)
    await new Promise(resolve => setTimeout(resolve, 100))

    // Simulate 95% success rate
    const success = Math.random() > 0.05

    if (success) {
      logger.debug('Deployed to node', { nodeId: node.id, version: config.version })
    } else {
      logger.warn('Failed to deploy to node', { nodeId: node.id })
    }

    return success
  }

  /**
   * Validate health of deployed nodes
   */
  private async validateHealth(slot: DeploymentSlot, config: DeploymentConfig): Promise<number> {
    let healthyCount = 0

    for (const nodeId of slot.nodes) {
      let isHealthy = false

      if (this.healthChecker) {
        isHealthy = await this.healthChecker(nodeId, config.healthCheckEndpoint)
      } else {
        // Simulate health check (90% healthy)
        isHealthy = Math.random() > 0.1
      }

      if (isHealthy) {
        healthyCount++
      }
    }

    return healthyCount
  }

  /**
   * Shift traffic between slots
   */
  private async shiftTraffic(targetSlot: 'blue' | 'green', percentage: number): Promise<void> {
    const previousSplit = { ...this.trafficSplit }

    if (targetSlot === 'blue') {
      this.trafficSplit.bluePercentage = Math.floor(percentage * 100)
      this.trafficSplit.greenPercentage = 100 - this.trafficSplit.bluePercentage
    } else {
      this.trafficSplit.greenPercentage = Math.floor(percentage * 100)
      this.trafficSplit.bluePercentage = 100 - this.trafficSplit.greenPercentage
    }

    this.trafficSplit.lastUpdated = Date.now()

    this.emit('traffic.shifted', { from: previousSplit, to: this.trafficSplit })
    logger.info('Traffic shifted', { targetSlot, percentage })
  }

  /**
   * Monitor for automatic rollback
   */
  private async monitorForRollback(deployment: DeploymentRecord, slot: DeploymentSlot): Promise<void> {
    const monitorDuration = 60000 // 1 minute
    const checkInterval = 5000
    const checks = monitorDuration / checkInterval

    for (let i = 0; i < checks; i++) {
      await new Promise(resolve => setTimeout(resolve, checkInterval))

      // Calculate error rate
      const totalRequests = slot.requestCount || 1
      const errorRate = (slot.errorCount / totalRequests) * 100

      // Simulate some requests
      slot.requestCount += Math.floor(Math.random() * 100)
      slot.errorCount += Math.floor(Math.random() * 5)
      slot.healthScore = Math.max(0, 100 - errorRate)

      if (errorRate > deployment.config.rollbackThreshold) {
        logger.warn('Error rate exceeded threshold, triggering rollback', { errorRate, threshold: deployment.config.rollbackThreshold })
        await this.rollback(deployment)
        throw new Error(`Error rate ${errorRate.toFixed(1)}% exceeded threshold ${deployment.config.rollbackThreshold}%`)
      }
    }
  }

  /**
   * Rollback deployment
   */
  async rollback(deployment: DeploymentRecord): Promise<void> {
    const previousSlot = deployment.activeSlot

    deployment.status = 'rolling-back'
    this.emit('rollback.triggered', { deploymentId: deployment.id, previousSlot })

    // Shift traffic back
    await this.shiftTraffic(previousSlot, 1.0)

    deployment.status = 'failed'
    deployment.endTime = Date.now()

    logger.warn('Rollback completed', { deploymentId: deployment.id, revertedTo: previousSlot })
  }

  /**
   * Get current traffic split
   */
  getTrafficSplit(): TrafficSplit {
    return { ...this.trafficSplit }
  }

  /**
   * Get active deployment
   */
  getActiveDeployment(): DeploymentRecord | null {
    return this.activeDeployment
  }

  /**
   * Get deployment by ID
   */
  getDeployment(deploymentId: string): DeploymentRecord | undefined {
    return this.deployments.get(deploymentId)
  }

  /**
   * Get all deployments
   */
  getAllDeployments(): DeploymentRecord[] {
    return Array.from(this.deployments.values())
  }

  /**
   * Cancel active deployment
   */
  async cancelDeployment(deploymentId: string): Promise<boolean> {
    const deployment = this.deployments.get(deploymentId)
    if (!deployment || !['pending', 'deploying', 'validating'].includes(deployment.status)) {
      return false
    }

    await this.rollback(deployment)
    return true
  }

  /**
   * Get deployment statistics
   */
  getStats(): {
    totalDeployments: number
    successfulDeployments: number
    failedDeployments: number
    activeSlot: 'blue' | 'green'
    trafficSplit: TrafficSplit
  } {
    let successful = 0
    let failed = 0

    for (const deployment of this.deployments.values()) {
      if (deployment.status === 'active' || deployment.status === 'completed') successful++
      if (deployment.status === 'failed') failed++
    }

    return {
      totalDeployments: this.deployments.size,
      successfulDeployments: successful,
      failedDeployments: failed,
      activeSlot: this.trafficSplit.bluePercentage >= 50 ? 'blue' : 'green',
      trafficSplit: this.getTrafficSplit(),
    }
  }

  /**
   * Subscribe to events
   */
  on(event: DeploymentEvent, callback: DeploymentCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: DeploymentEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Deployment callback error', error as Error)
      }
    })
  }
}

/**
 * Create blue-green deployment manager
 */
export function createBlueGreenDeploymentManager(): BlueGreenDeploymentManager {
  return new BlueGreenDeploymentManager()
}

// Default instance
export const blueGreenDeploymentManager = new BlueGreenDeploymentManager()
