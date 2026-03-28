/**
 * Geo-Routing Layer for Edge-Cloud Orchestrator
 * Routes tasks to geographically closest edge nodes
 */

import { logger } from '../logger'
import type { EdgeNode, Task } from '../../types'

// Types
export interface GeoLocation {
  latitude: number
  longitude: number
}

export interface NodeGeoInfo {
  nodeId: string
  location: GeoLocation
  region: string
  zone: string
  networkLatency: number // Measured latency from orchestrator
}

export interface RoutingConfig {
  defaultRegion: string
  fallbackToCloud: boolean
  maxDistance: number // Maximum distance in km before fallback
  latencyWeight: number
  distanceWeight: number
  loadWeight: number
}

export interface RoutingResult {
  selectedNode: EdgeNode | null
  reason: string
  distance?: number
  estimatedLatency?: number
  alternatives: Array<{ node: EdgeNode; score: number }>
}

type RoutingEvent = 'node.selected' | 'fallback.cloud' | 'no.nodes'
type RoutingCallback = (event: RoutingEvent, data: unknown) => void

const EARTH_RADIUS_KM = 6371

const DEFAULT_CONFIG: RoutingConfig = {
  defaultRegion: 'us-east',
  fallbackToCloud: true,
  maxDistance: 5000, // 5000 km
  latencyWeight: 0.4,
  distanceWeight: 0.3,
  loadWeight: 0.3,
}

/**
 * Geo-Router - Routes tasks based on geographic proximity
 */
export class GeoRouter {
  private config: RoutingConfig
  private nodeGeoInfo: Map<string, NodeGeoInfo> = new Map()
  private regionLatencies: Map<string, number> = new Map()
  private callbacks: Map<RoutingEvent, Set<RoutingCallback>> = new Map()

  constructor(config: Partial<RoutingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Register node geo information
   */
  registerNode(nodeId: string, geoInfo: NodeGeoInfo): void {
    this.nodeGeoInfo.set(nodeId, geoInfo)
    logger.info('Node geo info registered', { nodeId, region: geoInfo.region, zone: geoInfo.zone })
  }

  /**
   * Update node network latency
   */
  updateNodeLatency(nodeId: string, latency: number): void {
    const info = this.nodeGeoInfo.get(nodeId)
    if (info) {
      info.networkLatency = latency
    }
  }

  /**
   * Update region latency
   */
  updateRegionLatency(region: string, latency: number): void {
    this.regionLatencies.set(region, latency)
  }

  /**
   * Select best node for a task based on geo-routing
   */
  selectNode(
    task: Task,
    nodes: EdgeNode[],
    userLocation?: GeoLocation
  ): RoutingResult {
    if (nodes.length === 0) {
      this.emit('no.nodes', { taskId: task.id })
      return {
        selectedNode: null,
        reason: 'No nodes available',
        alternatives: [],
      }
    }

    // Filter online nodes
    const onlineNodes = nodes.filter(n => n.status === 'online' && !n.isMaintenanceMode)
    
    if (onlineNodes.length === 0) {
      this.emit('fallback.cloud', { taskId: task.id, reason: 'No online nodes' })
      return {
        selectedNode: null,
        reason: 'No online nodes available, fallback to cloud',
        alternatives: [],
      }
    }

    // Calculate scores for each node
    const scoredNodes = onlineNodes.map(node => {
      const score = this.calculateNodeScore(node, userLocation)
      return { node, score }
    })

    // Sort by score (higher is better)
    scoredNodes.sort((a, b) => b.score.total - a.score.total)

    const best = scoredNodes[0]
    const alternatives = scoredNodes.slice(1, 4).map(s => ({ node: s.node, score: s.score.total }))

    // Check if best node is within acceptable distance
    if (best.score.distance > this.config.maxDistance && this.config.fallbackToCloud) {
      this.emit('fallback.cloud', { taskId: task.id, distance: best.score.distance })
      return {
        selectedNode: null,
        reason: `All nodes too far (${Math.round(best.score.distance)}km > ${this.config.maxDistance}km), fallback to cloud`,
        distance: best.score.distance,
        alternatives,
      }
    }

    this.emit('node.selected', { 
      taskId: task.id, 
      nodeId: best.node.id, 
      score: best.score,
      distance: best.score.distance 
    })

    return {
      selectedNode: best.node,
      reason: `Best score: ${best.score.total.toFixed(2)} (distance: ${Math.round(best.score.distance)}km, latency: ${Math.round(best.score.latency)}ms)`,
      distance: best.score.distance,
      estimatedLatency: best.score.latency,
      alternatives,
    }
  }

  /**
   * Calculate node score based on distance, latency, and load
   */
  private calculateNodeScore(node: EdgeNode, userLocation?: GeoLocation): {
    total: number
    distance: number
    latency: number
    load: number
  } {
    const geoInfo = this.nodeGeoInfo.get(node.id)
    
    // Distance score (0-100, higher is better)
    let distance = 0
    let distanceScore = 50 // Default if no location
    
    if (userLocation && geoInfo) {
      distance = this.calculateDistance(userLocation, geoInfo.location)
      // Convert distance to score (closer = higher score)
      distanceScore = Math.max(0, 100 - (distance / this.config.maxDistance) * 100)
    }

    // Latency score (0-100, higher is better)
    const latency = geoInfo?.networkLatency || node.latency || 50
    const latencyScore = Math.max(0, 100 - latency)

    // Load score (0-100, higher is better)
    const cpuLoad = node.cpu || 0
    const memLoad = node.memory || 0
    const taskLoad = node.tasksRunning / Math.max(node.maxTasks, 1)
    const loadScore = 100 - ((cpuLoad + memLoad) / 2 + taskLoad * 50)

    // Weighted total score
    const total = 
      distanceScore * this.config.distanceWeight +
      latencyScore * this.config.latencyWeight +
      loadScore * this.config.loadWeight

    return {
      total,
      distance,
      latency,
      load: loadScore,
    }
  }

  /**
   * Calculate distance between two points using Haversine formula
   */
  calculateDistance(point1: GeoLocation, point2: GeoLocation): number {
    const dLat = this.toRadians(point2.latitude - point1.latitude)
    const dLon = this.toRadians(point2.longitude - point1.longitude)
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(point1.latitude)) * 
      Math.cos(this.toRadians(point2.latitude)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2)
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    
    return EARTH_RADIUS_KM * c
  }

  /**
   * Convert degrees to radians
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180)
  }

  /**
   * Get nodes within radius of a location
   */
  getNodesWithinRadius(
    nodes: EdgeNode[],
    center: GeoLocation,
    radiusKm: number
  ): EdgeNode[] {
    return nodes.filter(node => {
      const geoInfo = this.nodeGeoInfo.get(node.id)
      if (!geoInfo) return false
      
      const distance = this.calculateDistance(center, geoInfo.location)
      return distance <= radiusKm
    })
  }

  /**
   * Get nodes by region
   */
  getNodesByRegion(nodes: EdgeNode[], region: string): EdgeNode[] {
    return nodes.filter(node => {
      const geoInfo = this.nodeGeoInfo.get(node.id)
      return geoInfo?.region === region || node.region === region
    })
  }

  /**
   * Get nearest N nodes
   */
  getNearestNodes(
    nodes: EdgeNode[],
    location: GeoLocation,
    count: number = 3
  ): Array<{ node: EdgeNode; distance: number }> {
    const withDistance = nodes.map(node => {
      const geoInfo = this.nodeGeoInfo.get(node.id)
      const distance = geoInfo 
        ? this.calculateDistance(location, geoInfo.location)
        : Infinity
      
      return { node, distance }
    })

    withDistance.sort((a, b) => a.distance - b.distance)
    
    return withDistance.slice(0, count)
  }

  /**
   * Get region for a location
   */
  getRegionForLocation(location: GeoLocation): string {
    // Simple region detection based on longitude
    if (location.longitude >= -180 && location.longitude < -30) {
      return 'americas'
    } else if (location.longitude >= -30 && location.longitude < 60) {
      return 'europe-africa'
    } else {
      return 'asia-pacific'
    }
  }

  /**
   * Get routing statistics
   */
  getStats(): {
    registeredNodes: number
    regions: string[]
    avgLatencyByRegion: Record<string, number>
  } {
    const regions = new Set<string>()
    const latencyByRegion: Record<string, number[]> = {}

    for (const [_nodeId, info] of this.nodeGeoInfo) {
      regions.add(info.region)
      
      if (!latencyByRegion[info.region]) {
        latencyByRegion[info.region] = []
      }
      latencyByRegion[info.region].push(info.networkLatency)
    }

    const avgLatencyByRegion: Record<string, number> = {}
    for (const [region, latencies] of Object.entries(latencyByRegion)) {
      avgLatencyByRegion[region] = latencies.reduce((a, b) => a + b, 0) / latencies.length
    }

    return {
      registeredNodes: this.nodeGeoInfo.size,
      regions: Array.from(regions),
      avgLatencyByRegion,
    }
  }

  /**
   * Subscribe to events
   */
  on(event: RoutingEvent, callback: RoutingCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: RoutingEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('GeoRouter callback error', error as Error)
      }
    })
  }
}

/**
 * Location Resolver - Resolves user location from IP or coordinates
 */
export class LocationResolver {
  private locationCache: Map<string, GeoLocation> = new Map()

  /**
   * Resolve location from IP address
   */
  async resolveFromIP(ip: string): Promise<GeoLocation | null> {
    // Check cache
    const cached = this.locationCache.get(ip)
    if (cached) return cached

    // In production, use a geo-IP service
    // For now, return a default location
    const location = this.simulateGeoIP(ip)
    
    this.locationCache.set(ip, location)
    return location
  }

  /**
   * Simulate geo-IP resolution (for development)
   */
  private simulateGeoIP(ip: string): GeoLocation {
    // Hash IP to generate consistent but fake coordinates
    let hash = 0
    for (let i = 0; i < ip.length; i++) {
      hash = ((hash << 5) - hash) + ip.charCodeAt(i)
      hash = hash & hash
    }

    // Generate coordinates within reasonable ranges
    const latitude = (Math.abs(hash % 180) - 90) * (0.5 + Math.random() * 0.5)
    const longitude = (Math.abs((hash >> 8) % 360) - 180) * (0.5 + Math.random() * 0.5)

    return { latitude, longitude }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.locationCache.clear()
  }
}

/**
 * Routing Policy - Configurable routing strategies
 */
export type RoutingStrategy = 'nearest' | 'lowest-latency' | 'load-balanced' | 'cost-optimized' | 'region-pinned'

export interface RoutingPolicy {
  strategy: RoutingStrategy
  pinnedRegion?: string
  costThreshold?: number
  latencyThreshold?: number
}

export class RoutingPolicyEngine {
  private geoRouter: GeoRouter

  constructor(geoRouter: GeoRouter) {
    this.geoRouter = geoRouter
  }

  /**
   * Apply routing policy to select node
   */
  applyPolicy(
    policy: RoutingPolicy,
    task: Task,
    nodes: EdgeNode[],
    userLocation?: GeoLocation
  ): RoutingResult {
    switch (policy.strategy) {
      case 'nearest':
        return this.geoRouter.selectNode(task, nodes, userLocation)
      
      case 'lowest-latency':
        return this.selectLowestLatency(task, nodes)
      
      case 'load-balanced':
        return this.selectLoadBalanced(task, nodes, userLocation)
      
      case 'cost-optimized':
        return this.selectCostOptimized(task, nodes, policy.costThreshold)
      
      case 'region-pinned':
        return this.selectRegionPinned(task, nodes, policy.pinnedRegion || this.geoRouter['config'].defaultRegion)
      
      default:
        return this.geoRouter.selectNode(task, nodes, userLocation)
    }
  }

  private selectLowestLatency(_task: Task, nodes: EdgeNode[]): RoutingResult {
    const onlineNodes = nodes.filter(n => n.status === 'online')
    
    if (onlineNodes.length === 0) {
      return { selectedNode: null, reason: 'No online nodes', alternatives: [] }
    }

    const sorted = [...onlineNodes].sort((a, b) => (a.latency || 0) - (b.latency || 0))
    const best = sorted[0]

    return {
      selectedNode: best,
      reason: `Lowest latency: ${best.latency}ms`,
      estimatedLatency: best.latency,
      alternatives: sorted.slice(1, 4).map(n => ({ node: n, score: -(n.latency || 0) })),
    }
  }

  private selectLoadBalanced(_task: Task, nodes: EdgeNode[], _userLocation?: GeoLocation): RoutingResult {
    const onlineNodes = nodes.filter(n => n.status === 'online')
    
    if (onlineNodes.length === 0) {
      return { selectedNode: null, reason: 'No online nodes', alternatives: [] }
    }

    // Sort by lowest load
    const sorted = [...onlineNodes].sort((a, b) => {
      const loadA = (a.cpu + a.memory) / 2 + (a.tasksRunning / a.maxTasks) * 50
      const loadB = (b.cpu + b.memory) / 2 + (b.tasksRunning / b.maxTasks) * 50
      return loadA - loadB
    })

    const best = sorted[0]
    const geoInfo = this.geoRouter['nodeGeoInfo'].get(best.id)
    
    return {
      selectedNode: best,
      reason: `Lowest load node`,
      estimatedLatency: geoInfo?.networkLatency || best.latency,
      alternatives: sorted.slice(1, 4).map(n => ({ 
        node: n, 
        score: 100 - ((n.cpu + n.memory) / 2) 
      })),
    }
  }

  private selectCostOptimized(_task: Task, nodes: EdgeNode[], threshold?: number): RoutingResult {
    const onlineNodes = nodes.filter(n => n.status === 'online')
    
    if (onlineNodes.length === 0) {
      return { selectedNode: null, reason: 'No online nodes', alternatives: [] }
    }

    const maxCost = threshold || 0.05
    const affordable = onlineNodes.filter(n => n.costPerHour <= maxCost)

    if (affordable.length === 0) {
      return {
        selectedNode: null,
        reason: `No nodes under cost threshold ($${maxCost}/hr)`,
        alternatives: [],
      }
    }

    const sorted = [...affordable].sort((a, b) => a.costPerHour - b.costPerHour)
    const best = sorted[0]

    return {
      selectedNode: best,
      reason: `Lowest cost: $${best.costPerHour}/hr`,
      alternatives: sorted.slice(1, 4).map(n => ({ node: n, score: -n.costPerHour * 1000 })),
    }
  }

  private selectRegionPinned(_task: Task, nodes: EdgeNode[], region: string): RoutingResult {
    const regionNodes = nodes.filter(n => 
      n.status === 'online' && 
      (n.region === region || this.geoRouter['nodeGeoInfo'].get(n.id)?.region === region)
    )

    if (regionNodes.length === 0) {
      return {
        selectedNode: null,
        reason: `No nodes in pinned region: ${region}`,
        alternatives: [],
      }
    }

    // Select best within region
    const sorted = [...regionNodes].sort((a, b) => (a.latency || 0) - (b.latency || 0))
    const best = sorted[0]

    return {
      selectedNode: best,
      reason: `Best node in pinned region ${region}`,
      estimatedLatency: best.latency,
      alternatives: sorted.slice(1, 4).map(n => ({ node: n, score: -(n.latency || 0) })),
    }
  }
}

// Factory functions
export function createGeoRouter(config: Partial<RoutingConfig> = {}): GeoRouter {
  return new GeoRouter(config)
}

export function createLocationResolver(): LocationResolver {
  return new LocationResolver()
}

export function createRoutingPolicyEngine(geoRouter: GeoRouter): RoutingPolicyEngine {
  return new RoutingPolicyEngine(geoRouter)
}

// Default instances
export const geoRouter = new GeoRouter()
export const locationResolver = new LocationResolver()
export const routingPolicyEngine = new RoutingPolicyEngine(geoRouter)
