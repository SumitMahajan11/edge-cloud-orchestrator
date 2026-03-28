/**
 * Multi-Region Coordinator
 * Coordinates orchestrators across multiple geographic regions
 */

import { logger } from '../logger'
import type { Task } from '../../types'

// Types
export interface Region {
  id: string
  name: string
  location: { latitude: number; longitude: number }
  timezone: string
  orchestratorUrl: string
  status: 'active' | 'degraded' | 'offline'
  nodeCount: number
  capacity: RegionCapacity
  latency: Map<string, number> // Latency to other regions
}

export interface RegionCapacity {
  totalCpu: number
  totalMemory: number
  availableCpu: number
  availableMemory: number
  maxTasks: number
  runningTasks: number
}

export interface RegionTask {
  taskId: string
  sourceRegion: string
  targetRegion: string
  status: 'pending' | 'dispatched' | 'acknowledged' | 'completed' | 'failed'
  dispatchedAt?: number
  completedAt?: number
  result?: unknown
}

export interface CrossRegionSync {
  sourceRegion: string
  targetRegion: string
  lastSync: number
  syncType: 'full' | 'incremental'
  status: 'syncing' | 'completed' | 'failed'
  itemsSynced: number
}

export interface RegionPolicy {
  name: string
  dataResidency: string[] // Regions where data must stay
  failoverRegions: string[] // Preferred failover targets
  latencyThreshold: number // Max acceptable latency in ms
  costOptimization: boolean
}

export interface MultiRegionConfig {
  localRegion: string
  syncInterval: number
  heartbeatInterval: number
  failoverTimeout: number
  maxCrossRegionLatency: number
}

type RegionEvent = 'region.added' | 'region.offline' | 'region.failed_over' | 'task.dispatched' | 'sync.completed'
type RegionCallback = (event: RegionEvent, data: unknown) => void

/**
 * Multi-Region Coordinator
 */
export class MultiRegionCoordinator {
  private config: MultiRegionConfig
  private regions: Map<string, Region> = new Map()
  private crossRegionTasks: Map<string, RegionTask> = new Map()
  private syncStatus: Map<string, CrossRegionSync> = new Map()
  private policies: Map<string, RegionPolicy> = new Map()
  private callbacks: Map<RegionEvent, Set<RegionCallback>> = new Map()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private syncTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: Partial<MultiRegionConfig> & { localRegion: string }) {
    this.config = {
      syncInterval: 30000,
      heartbeatInterval: 10000,
      failoverTimeout: 60000,
      maxCrossRegionLatency: 200,
      ...config,
    }
  }

  /**
   * Register a region
   */
  registerRegion(region: Omit<Region, 'latency'>): void {
    const fullRegion: Region = {
      ...region,
      latency: new Map(),
    }

    this.regions.set(region.id, fullRegion)
    this.emit('region.added', region)

    logger.info('Region registered', {
      regionId: region.id,
      name: region.name,
      location: region.location,
    })

    // Measure latency to other regions
    this.measureLatency(region.id)
  }

  /**
   * Measure latency between regions
   */
  private async measureLatency(regionId: string): Promise<void> {
    const region = this.regions.get(regionId)
    if (!region) return

    for (const [otherId, otherRegion] of this.regions) {
      if (otherId === regionId) continue

      // Simulate latency measurement (in production, would ping actual endpoints)
      const distance = this.calculateDistance(
        region.location,
        otherRegion.location
      )

      // Rough estimate: 1ms per 200km + base latency
      const estimatedLatency = Math.round(distance / 200) + 10
      region.latency.set(otherId, estimatedLatency)
      otherRegion.latency.set(regionId, estimatedLatency)
    }
  }

  /**
   * Calculate distance between two points (Haversine)
   */
  private calculateDistance(
    p1: { latitude: number; longitude: number },
    p2: { latitude: number; longitude: number }
  ): number {
    const R = 6371 // Earth radius in km
    const dLat = this.toRad(p2.latitude - p1.latitude)
    const dLon = this.toRad(p2.longitude - p1.longitude)
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(p1.latitude)) * Math.cos(this.toRad(p2.latitude)) *
      Math.sin(dLon / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180)
  }

  /**
   * Get region for task based on policy and constraints
   */
  selectRegionForTask(
    task: Task,
    userLocation?: { latitude: number; longitude: number }
  ): { regionId: string; reason: string } | null {
    const policy = this.policies.get(task.type) || this.getDefaultPolicy()

    // Filter active regions
    const activeRegions = Array.from(this.regions.values())
      .filter(r => r.status === 'active')

    if (activeRegions.length === 0) {
      logger.warn('No active regions available')
      return null
    }

    // Check data residency constraints
    let candidates = activeRegions
    if (policy.dataResidency.length > 0) {
      candidates = candidates.filter(r => policy.dataResidency.includes(r.id))
    }

    // Check latency threshold
    if (userLocation) {
      candidates = candidates.filter(r => {
        const distance = this.calculateDistance(userLocation, r.location)
        const estimatedLatency = distance / 200 + 10
        return estimatedLatency <= policy.latencyThreshold
      })
    }

    if (candidates.length === 0) {
      // Fall back to nearest region
      if (userLocation) {
        const nearest = this.findNearestRegion(userLocation, activeRegions)
        return nearest ? { regionId: nearest.id, reason: 'Nearest available region' } : null
      }
      return { regionId: activeRegions[0].id, reason: 'Default region' }
    }

    // Score candidates
    const scored = candidates.map(region => {
      let score = 0

      // Capacity score
      const capacityRatio = region.capacity.availableCpu / Math.max(region.capacity.totalCpu, 1)
      score += capacityRatio * 30

      // Latency score (if user location)
      if (userLocation) {
        const distance = this.calculateDistance(userLocation, region.location)
        const latencyScore = Math.max(0, 100 - distance / 50)
        score += latencyScore * 0.4
      }

      // Load score
      const loadRatio = region.capacity.runningTasks / Math.max(region.capacity.maxTasks, 1)
      score += (1 - loadRatio) * 30

      return { region, score }
    })

    scored.sort((a, b) => b.score - a.score)

    return {
      regionId: scored[0].region.id,
      reason: `Best score: ${scored[0].score.toFixed(1)}`,
    }
  }

  /**
   * Find nearest region
   */
  private findNearestRegion(
    location: { latitude: number; longitude: number },
    regions: Region[]
  ): Region | null {
    if (regions.length === 0) return null

    let nearest = regions[0]
    let minDistance = this.calculateDistance(location, nearest.location)

    for (const region of regions.slice(1)) {
      const distance = this.calculateDistance(location, region.location)
      if (distance < minDistance) {
        minDistance = distance
        nearest = region
      }
    }

    return nearest
  }

  /**
   * Dispatch task to another region
   */
  async dispatchToRegion(task: Task, targetRegionId: string): Promise<RegionTask> {
    const targetRegion = this.regions.get(targetRegionId)
    if (!targetRegion || targetRegion.status !== 'active') {
      throw new Error(`Target region ${targetRegionId} not available`)
    }

    const regionTask: RegionTask = {
      taskId: task.id,
      sourceRegion: this.config.localRegion,
      targetRegion: targetRegionId,
      status: 'dispatched',
      dispatchedAt: Date.now(),
    }

    this.crossRegionTasks.set(task.id, regionTask)
    this.emit('task.dispatched', { taskId: task.id, targetRegion: targetRegionId })

    logger.info('Task dispatched to region', {
      taskId: task.id,
      targetRegion: targetRegionId,
    })

    // Simulate dispatch (in production, would call remote orchestrator)
    setTimeout(() => {
      regionTask.status = 'acknowledged'
    }, 100)

    return regionTask
  }

  /**
   * Handle region failure
   */
  async handleRegionFailure(failedRegionId: string): Promise<void> {
    const failedRegion = this.regions.get(failedRegionId)
    if (!failedRegion) return

    failedRegion.status = 'offline'
    this.emit('region.offline', { regionId: failedRegionId })

    logger.error('Region failure detected', new Error('Region offline'), { regionId: failedRegionId })

    // Find failover targets
    const policy = this.policies.get('default') || this.getDefaultPolicy()
    const failoverTargets = policy.failoverRegions
      .map(id => this.regions.get(id))
      .filter(r => r && r.status === 'active')

    if (failoverTargets.length === 0) {
      logger.error('No failover targets available for failed region', new Error('No failover'), { failedRegionId })
      return
    }

    // Migrate tasks from failed region
    const affectedTasks = Array.from(this.crossRegionTasks.values())
      .filter(t => t.targetRegion === failedRegionId && t.status !== 'completed')

    for (const task of affectedTasks) {
      const target = failoverTargets[0]
      if (target) {
        task.targetRegion = target.id
        task.status = 'dispatched'
        this.emit('region.failed_over', { taskId: task.taskId, fromRegion: failedRegionId, toRegion: target.id })
        logger.info('Task failed over', { taskId: task.taskId, toRegion: target.id })
      }
    }
  }

  /**
   * Get default policy
   */
  private getDefaultPolicy(): RegionPolicy {
    return {
      name: 'default',
      dataResidency: [],
      failoverRegions: Array.from(this.regions.keys()).filter(id => id !== this.config.localRegion),
      latencyThreshold: this.config.maxCrossRegionLatency,
      costOptimization: false,
    }
  }

  /**
   * Set region policy
   */
  setPolicy(taskType: string, policy: RegionPolicy): void {
    this.policies.set(taskType, policy)
    logger.info('Region policy set', { taskType, policy: policy.name })
  }

  /**
   * Get region info
   */
  getRegion(regionId: string): Region | undefined {
    return this.regions.get(regionId)
  }

  /**
   * Get all regions
   */
  getAllRegions(): Region[] {
    return Array.from(this.regions.values())
  }

  /**
   * Get active regions
   */
  getActiveRegions(): Region[] {
    return Array.from(this.regions.values()).filter(r => r.status === 'active')
  }

  /**
   * Update region capacity
   */
  updateRegionCapacity(regionId: string, capacity: Partial<RegionCapacity>): void {
    const region = this.regions.get(regionId)
    if (region) {
      region.capacity = { ...region.capacity, ...capacity }
    }
  }

  /**
   * Get cross-region task status
   */
  getCrossRegionTask(taskId: string): RegionTask | undefined {
    return this.crossRegionTasks.get(taskId)
  }

  /**
   * Get sync status
   */
  getSyncStatus(): CrossRegionSync[] {
    return Array.from(this.syncStatus.values())
  }

  /**
   * Start monitoring
   */
  startMonitoring(): void {
    // Heartbeat timer
    this.heartbeatTimer = setInterval(() => {
      this.checkRegionHealth()
    }, this.config.heartbeatInterval)

    // Sync timer
    this.syncTimer = setInterval(() => {
      this.syncRegions()
    }, this.config.syncInterval)
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
      this.syncTimer = null
    }
  }

  /**
   * Check region health
   */
  private checkRegionHealth(): void {
    for (const region of this.regions.values()) {
      if (region.id === this.config.localRegion) continue

      // Simulate health check (in production, would ping actual endpoints)
      const isHealthy = Math.random() > 0.05 // 95% uptime simulation

      if (!isHealthy && region.status === 'active') {
        this.handleRegionFailure(region.id)
      }
    }
  }

  /**
   * Sync state across regions
   */
  private syncRegions(): void {
    for (const region of this.regions.values()) {
      if (region.id === this.config.localRegion) continue
      if (region.status !== 'active') continue

      const sync: CrossRegionSync = {
        sourceRegion: this.config.localRegion,
        targetRegion: region.id,
        lastSync: Date.now(),
        syncType: 'incremental',
        status: 'syncing',
        itemsSynced: 0,
      }

      this.syncStatus.set(`${this.config.localRegion}-${region.id}`, sync)

      // Simulate sync (in production, would send actual data)
      setTimeout(() => {
        sync.status = 'completed'
        sync.itemsSynced = Math.floor(Math.random() * 100)
        this.emit('sync.completed', sync)
      }, 100)
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalRegions: number
    activeRegions: number
    offlineRegions: number
    crossRegionTasks: number
    avgLatency: number
  } {
    let active = 0
    let offline = 0
    let totalLatency = 0
    let latencyCount = 0

    for (const region of this.regions.values()) {
      if (region.status === 'active') active++
      if (region.status === 'offline') offline++

      for (const latency of region.latency.values()) {
        totalLatency += latency
        latencyCount++
      }
    }

    return {
      totalRegions: this.regions.size,
      activeRegions: active,
      offlineRegions: offline,
      crossRegionTasks: this.crossRegionTasks.size,
      avgLatency: latencyCount > 0 ? totalLatency / latencyCount : 0,
    }
  }

  /**
   * Subscribe to events
   */
  on(event: RegionEvent, callback: RegionCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: RegionEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Multi-region callback error', error as Error)
      }
    })
  }
}

/**
 * Create multi-region coordinator
 */
export function createMultiRegionCoordinator(config: Partial<MultiRegionConfig> & { localRegion: string }): MultiRegionCoordinator {
  return new MultiRegionCoordinator(config)
}

// Default instance
export const multiRegionCoordinator = new MultiRegionCoordinator({ localRegion: 'us-east' })
