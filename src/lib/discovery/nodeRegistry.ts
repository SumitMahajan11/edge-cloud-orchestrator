/**
 * Edge Node Auto-Discovery Registry
 * Handles automatic node registration, heartbeat tracking, and discovery
 */

import { logger } from '../logger'
import type { EdgeNode } from '../../types'

// Types
export interface NodeRegistration {
  nodeId: string
  ip: string
  location: string
  region: string
  cpuCores: number
  memory: number
  storage: number
  dockerVersion: string
  capabilities: string[]
  tags: Record<string, string>
  registeredAt: number
  lastHeartbeat: number
  status: 'online' | 'offline' | 'maintenance'
  metadata: Record<string, unknown>
}

export interface HeartbeatData {
  nodeId: string
  cpu: number
  memory: number
  storage: number
  tasksRunning: number
  latency: number
  timestamp: number
}

export interface DiscoveryConfig {
  heartbeatTimeout: number // Time without heartbeat before node is considered offline
  cleanupInterval: number // Interval to clean up offline nodes
  maxNodes: number // Maximum number of nodes in registry
}

type DiscoveryEvent = 'node.registered' | 'node.offline' | 'node.removed' | 'node.heartbeat' | 'node.updated'
type DiscoveryCallback = (event: DiscoveryEvent, data: unknown) => void

const DEFAULT_CONFIG: DiscoveryConfig = {
  heartbeatTimeout: 15000, // 15 seconds
  cleanupInterval: 30000, // 30 seconds
  maxNodes: 1000,
}

/**
 * Node Registry - Manages edge node discovery and lifecycle
 */
export class NodeRegistry {
  private config: DiscoveryConfig
  private nodes: Map<string, NodeRegistration> = new Map()
  private nodeMetrics: Map<string, HeartbeatData> = new Map()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private callbacks: Map<DiscoveryEvent, Set<DiscoveryCallback>> = new Map()

  constructor(config: Partial<DiscoveryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Start the registry
   */
  start(): void {
    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanupOfflineNodes()
    }, this.config.cleanupInterval)

    logger.info('Node registry started', { 
      heartbeatTimeout: this.config.heartbeatTimeout,
      maxNodes: this.config.maxNodes 
    })
  }

  /**
   * Stop the registry
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }

    logger.info('Node registry stopped', { registeredNodes: this.nodes.size })
  }

  /**
   * Register a new node
   */
  register(registration: Omit<NodeRegistration, 'registeredAt' | 'lastHeartbeat' | 'status'>): NodeRegistration {
    const existingNode = this.nodes.get(registration.nodeId)
    
    if (existingNode) {
      // Update existing node
      const updated: NodeRegistration = {
        ...existingNode,
        ...registration,
        status: 'online',
        lastHeartbeat: Date.now(),
      }
      
      this.nodes.set(registration.nodeId, updated)
      this.emit('node.updated', { nodeId: registration.nodeId })
      logger.info('Node re-registered', { nodeId: registration.nodeId, ip: registration.ip })
      
      return updated
    }

    // Check max nodes
    if (this.nodes.size >= this.config.maxNodes) {
      throw new Error('Maximum number of nodes reached')
    }

    // Create new registration
    const node: NodeRegistration = {
      ...registration,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
      status: 'online',
    }

    this.nodes.set(registration.nodeId, node)
    this.emit('node.registered', { nodeId: registration.nodeId, ip: registration.ip })
    logger.info('Node registered', { 
      nodeId: registration.nodeId, 
      ip: registration.ip, 
      location: registration.location,
      region: registration.region 
    })

    return node
  }

  /**
   * Process heartbeat from a node
   */
  heartbeat(data: HeartbeatData): boolean {
    const node = this.nodes.get(data.nodeId)
    
    if (!node) {
      logger.warn('Heartbeat from unknown node', { nodeId: data.nodeId })
      return false
    }

    // Update node status
    node.lastHeartbeat = data.timestamp || Date.now()
    node.status = 'online'

    // Store metrics
    this.nodeMetrics.set(data.nodeId, data)
    this.emit('node.heartbeat', { nodeId: data.nodeId, metrics: data })

    return true
  }

  /**
   * Deregister a node
   */
  deregister(nodeId: string): boolean {
    const node = this.nodes.get(nodeId)
    
    if (!node) {
      return false
    }

    this.nodes.delete(nodeId)
    this.nodeMetrics.delete(nodeId)
    
    this.emit('node.removed', { nodeId })
    logger.info('Node deregistered', { nodeId })

    return true
  }

  /**
   * Get node by ID
   */
  getNode(nodeId: string): NodeRegistration | undefined {
    return this.nodes.get(nodeId)
  }

  /**
   * Get all nodes
   */
  getAllNodes(): NodeRegistration[] {
    return Array.from(this.nodes.values())
  }

  /**
   * Get online nodes
   */
  getOnlineNodes(): NodeRegistration[] {
    return this.getAllNodes().filter(n => n.status === 'online')
  }

  /**
   * Get nodes by region
   */
  getNodesByRegion(region: string): NodeRegistration[] {
    return this.getAllNodes().filter(n => n.region === region)
  }

  /**
   * Get nodes by capability
   */
  getNodesByCapability(capability: string): NodeRegistration[] {
    return this.getAllNodes().filter(n => n.capabilities.includes(capability))
  }

  /**
   * Get node metrics
   */
  getNodeMetrics(nodeId: string): HeartbeatData | undefined {
    return this.nodeMetrics.get(nodeId)
  }

  /**
   * Check if node is online
   */
  isNodeOnline(nodeId: string): boolean {
    const node = this.nodes.get(nodeId)
    if (!node) return false

    const now = Date.now()
    return node.status === 'online' && (now - node.lastHeartbeat) < this.config.heartbeatTimeout
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalNodes: number
    onlineNodes: number
    offlineNodes: number
    maintenanceNodes: number
    regions: Record<string, number>
  } {
    const nodes = this.getAllNodes()
    const now = Date.now()

    let onlineNodes = 0
    let offlineNodes = 0
    let maintenanceNodes = 0
    const regions: Record<string, number> = {}

    for (const node of nodes) {
      // Check if actually online based on heartbeat
      const isOnline = (now - node.lastHeartbeat) < this.config.heartbeatTimeout
      
      if (node.status === 'maintenance') {
        maintenanceNodes++
      } else if (isOnline) {
        onlineNodes++
      } else {
        offlineNodes++
      }

      // Count by region
      regions[node.region] = (regions[node.region] || 0) + 1
    }

    return {
      totalNodes: nodes.length,
      onlineNodes,
      offlineNodes,
      maintenanceNodes,
      regions,
    }
  }

  /**
   * Convert to EdgeNode format for compatibility
   */
  toEdgeNode(registration: NodeRegistration): EdgeNode {
    const metrics = this.nodeMetrics.get(registration.nodeId)
    
    return {
      id: registration.nodeId,
      name: `edge-${registration.nodeId.slice(0, 8)}`,
      location: registration.location,
      region: registration.region,
      status: registration.status === 'online' ? 'online' : 'offline',
      cpu: metrics?.cpu || 0,
      memory: metrics?.memory || 0,
      storage: registration.storage,
      latency: metrics?.latency || 0,
      uptime: 99.9, // Would be calculated from history
      tasksRunning: metrics?.tasksRunning || 0,
      maxTasks: Math.floor(registration.cpuCores * 2), // Rough estimate
      lastHeartbeat: new Date(registration.lastHeartbeat),
      ip: registration.ip,
      url: `http://${registration.ip}:4000`,
      costPerHour: 0.02, // Default
      bandwidthIn: 50,
      bandwidthOut: 50,
      healthHistory: [],
      isMaintenanceMode: registration.status === 'maintenance',
    }
  }

  /**
   * Cleanup offline nodes
   */
  private cleanupOfflineNodes(): void {
    const now = Date.now()
    const offlineThreshold = this.config.heartbeatTimeout * 2 // Double timeout before removal

    for (const [nodeId, node] of this.nodes) {
      const timeSinceHeartbeat = now - node.lastHeartbeat

      if (timeSinceHeartbeat > this.config.heartbeatTimeout && node.status === 'online') {
        // Mark as offline
        node.status = 'offline'
        this.emit('node.offline', { nodeId, lastHeartbeat: node.lastHeartbeat })
        logger.warn('Node marked offline', { nodeId, timeSinceHeartbeat })
      }

      if (timeSinceHeartbeat > offlineThreshold) {
        // Remove completely
        this.nodes.delete(nodeId)
        this.nodeMetrics.delete(nodeId)
        this.emit('node.removed', { nodeId, reason: 'timeout' })
        logger.info('Node removed due to timeout', { nodeId, timeSinceHeartbeat })
      }
    }
  }

  /**
   * Subscribe to events
   */
  on(event: DiscoveryEvent, callback: DiscoveryCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: DiscoveryEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Node registry callback error', error as Error)
      }
    })
  }
}

/**
 * Node Discovery Service - API for node registration
 */
export class NodeDiscoveryService {
  private registry: NodeRegistry
  private authMiddleware?: (nodeId: string, token: string) => Promise<boolean>

  constructor(registry: NodeRegistry) {
    this.registry = registry
  }

  /**
   * Set authentication middleware
   */
  setAuthMiddleware(middleware: (nodeId: string, token: string) => Promise<boolean>): void {
    this.authMiddleware = middleware
  }

  /**
   * Handle registration request
   */
  async handleRegistration(
    request: {
      nodeId: string
      ip: string
      location: string
      region: string
      cpuCores: number
      memory: number
      storage: number
      dockerVersion: string
      capabilities?: string[]
      tags?: Record<string, string>
      metadata?: Record<string, unknown>
      token?: string
    }
  ): Promise<{ success: boolean; node?: NodeRegistration; error?: string }> {
    try {
      // Authenticate if middleware is set
      if (this.authMiddleware && request.token) {
        const authenticated = await this.authMiddleware(request.nodeId, request.token)
        if (!authenticated) {
          return { success: false, error: 'Authentication failed' }
        }
      }

      const node = this.registry.register({
        nodeId: request.nodeId,
        ip: request.ip,
        location: request.location,
        region: request.region,
        cpuCores: request.cpuCores,
        memory: request.memory,
        storage: request.storage,
        dockerVersion: request.dockerVersion,
        capabilities: request.capabilities || [],
        tags: request.tags || {},
        metadata: request.metadata || {},
      })

      return { success: true, node }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Handle heartbeat request
   */
  async handleHeartbeat(
    data: HeartbeatData & { token?: string }
  ): Promise<{ success: boolean; error?: string }> {
    // Authenticate if middleware is set
    if (this.authMiddleware && data.token) {
      const authenticated = await this.authMiddleware(data.nodeId, data.token)
      if (!authenticated) {
        return { success: false, error: 'Authentication failed' }
      }
    }

    const success = this.registry.heartbeat(data)
    return { success }
  }

  /**
   * Handle deregistration request
   */
  async handleDeregistration(
    nodeId: string,
    token?: string
  ): Promise<{ success: boolean; error?: string }> {
    // Authenticate if middleware is set
    if (this.authMiddleware && token) {
      const authenticated = await this.authMiddleware(nodeId, token)
      if (!authenticated) {
        return { success: false, error: 'Authentication failed' }
      }
    }

    const success = this.registry.deregister(nodeId)
    return { success }
  }

  /**
   * Get registry statistics
   */
  getStats() {
    return this.registry.getStats()
  }
}

// Factory functions
export function createNodeRegistry(config: Partial<DiscoveryConfig> = {}): NodeRegistry {
  return new NodeRegistry(config)
}

export function createDiscoveryService(registry: NodeRegistry): NodeDiscoveryService {
  return new NodeDiscoveryService(registry)
}

// Default instances
export const nodeRegistry = new NodeRegistry()
export const discoveryService = new NodeDiscoveryService(nodeRegistry)
