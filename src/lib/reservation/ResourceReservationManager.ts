/**
 * Resource Reservation System
 * Provides advance resource booking for guaranteed execution
 */

import { logger } from '../logger'
import type { EdgeNode, TaskPriority } from '../../types'

// Types
export interface ResourceReservation {
  id: string
  taskId: string
  nodeId: string
  resources: ReservedResources
  priority: TaskPriority
  createdAt: number
  startTime: number
  endTime: number
  status: 'pending' | 'active' | 'completed' | 'cancelled' | 'expired'
  guaranteed: boolean
}

export interface ReservedResources {
  cpuCores: number      // Number of CPU cores
  memoryMB: number      // Memory in MB
  storageGB: number     // Storage in GB
  networkMbps: number   // Network bandwidth
  gpuUnits: number      // GPU units (if applicable)
}

export interface NodeCapacity {
  nodeId: string
  totalCpuCores: number
  totalMemoryMB: number
  totalStorageGB: number
  totalNetworkMbps: number
  totalGpuUnits: number
  reservedCpuCores: number
  reservedMemoryMB: number
  reservedStorageGB: number
  reservedNetworkMbps: number
  reservedGpuUnits: number
}

export interface ReservationRequest {
  taskId: string
  taskType: string
  priority: TaskPriority
  resources: ReservedResources
  startTime: number      // Desired start time
  duration: number       // Duration in ms
  preferredNodeIds?: string[]
  antiAffinityNodeIds?: string[]
  preemptible: boolean   // Can be preempted by higher priority
}

export interface ReservationConfig {
  maxReservationDuration: number
  minAdvanceTime: number
  maxAdvanceTime: number
  overcommitRatio: number
  preemptionEnabled: boolean
}

type ReservationEvent = 'reservation.created' | 'reservation.activated' | 'reservation.cancelled' | 'reservation.preempted'
type ReservationCallback = (event: ReservationEvent, data: unknown) => void

const DEFAULT_CONFIG: ReservationConfig = {
  maxReservationDuration: 3600000, // 1 hour
  minAdvanceTime: 0,
  maxAdvanceTime: 86400000, // 24 hours
  overcommitRatio: 1.2,
  preemptionEnabled: true,
}

/**
 * Resource Reservation Manager
 */
export class ResourceReservationManager {
  private config: ReservationConfig
  private reservations: Map<string, ResourceReservation> = new Map()
  private nodeCapacities: Map<string, NodeCapacity> = new Map()
  private taskReservations: Map<string, string> = new Map() // taskId -> reservationId
  private callbacks: Map<ReservationEvent, Set<ReservationCallback>> = new Map()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private nodeProvider: (() => EdgeNode[]) | null = null

  constructor(config: Partial<ReservationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.startCleanup()
  }

  /**
   * Set node provider
   */
  setNodeProvider(provider: () => EdgeNode[]): void {
    this.nodeProvider = provider
    this.syncNodeCapacities()
  }

  /**
   * Sync node capacities from provider
   */
  private syncNodeCapacities(): void {
    if (!this.nodeProvider) return

    const nodes = this.nodeProvider()
    for (const node of nodes) {
      if (!this.nodeCapacities.has(node.id)) {
        this.nodeCapacities.set(node.id, {
          nodeId: node.id,
          totalCpuCores: 8, // Default
          totalMemoryMB: 8192,
          totalStorageGB: 100,
          totalNetworkMbps: 1000,
          totalGpuUnits: 0,
          reservedCpuCores: 0,
          reservedMemoryMB: 0,
          reservedStorageGB: 0,
          reservedNetworkMbps: 0,
          reservedGpuUnits: 0,
        })
      }
    }
  }

  /**
   * Request a reservation
   */
  requestReservation(request: ReservationRequest): ResourceReservation | null {
    // Validate timing
    const now = Date.now()
    if (request.startTime < now + this.config.minAdvanceTime) {
      logger.warn('Reservation start time too soon', { taskId: request.taskId })
      return null
    }
    if (request.startTime > now + this.config.maxAdvanceTime) {
      logger.warn('Reservation start time too far in future', { taskId: request.taskId })
      return null
    }
    if (request.duration > this.config.maxReservationDuration) {
      logger.warn('Reservation duration too long', { taskId: request.taskId })
      return null
    }

    // Find suitable node
    const nodeId = this.findSuitableNode(request)
    if (!nodeId) {
      logger.warn('No suitable node for reservation', { taskId: request.taskId })
      return null
    }

    // Create reservation
    const reservationId = `res-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const reservation: ResourceReservation = {
      id: reservationId,
      taskId: request.taskId,
      nodeId,
      resources: request.resources,
      priority: request.priority,
      createdAt: now,
      startTime: request.startTime,
      endTime: request.startTime + request.duration,
      status: 'pending',
      guaranteed: !request.preemptible,
    }

    this.reservations.set(reservationId, reservation)
    this.taskReservations.set(request.taskId, reservationId)

    // Update node capacity
    this.reserveCapacity(nodeId, request.resources)

    this.emit('reservation.created', reservation)
    logger.info('Reservation created', {
      reservationId,
      taskId: request.taskId,
      nodeId,
      resources: request.resources,
      startTime: new Date(request.startTime).toISOString(),
    })

    return reservation
  }

  /**
   * Find suitable node for reservation
   */
  private findSuitableNode(request: ReservationRequest): string | null {
    const candidates: Array<{ nodeId: string; available: ReservedResources }> = []

    for (const [nodeId, capacity] of this.nodeCapacities) {
      // Skip anti-affinity nodes
      if (request.antiAffinityNodeIds?.includes(nodeId)) continue

      // Calculate available resources
      const available: ReservedResources = {
        cpuCores: capacity.totalCpuCores - capacity.reservedCpuCores,
        memoryMB: capacity.totalMemoryMB - capacity.reservedMemoryMB,
        storageGB: capacity.totalStorageGB - capacity.reservedStorageGB,
        networkMbps: capacity.totalNetworkMbps - capacity.reservedNetworkMbps,
        gpuUnits: capacity.totalGpuUnits - capacity.reservedGpuUnits,
      }

      // Apply overcommit
      available.cpuCores = Math.floor(available.cpuCores * this.config.overcommitRatio)
      available.memoryMB = Math.floor(available.memoryMB * this.config.overcommitRatio)

      // Check if sufficient
      if (available.cpuCores >= request.resources.cpuCores &&
          available.memoryMB >= request.resources.memoryMB &&
          available.storageGB >= request.resources.storageGB &&
          available.networkMbps >= request.resources.networkMbps &&
          available.gpuUnits >= request.resources.gpuUnits) {
        
        candidates.push({ nodeId, available })
      }
    }

    if (candidates.length === 0) return null

    // Sort by preference, then by available resources
    candidates.sort((a, b) => {
      const aPreferred = request.preferredNodeIds?.includes(a.nodeId) ? 1 : 0
      const bPreferred = request.preferredNodeIds?.includes(b.nodeId) ? 1 : 0
      if (aPreferred !== bPreferred) return bPreferred - aPreferred
      return b.available.cpuCores - a.available.cpuCores
    })

    return candidates[0].nodeId
  }

  /**
   * Reserve capacity on node
   */
  private reserveCapacity(nodeId: string, resources: ReservedResources): void {
    const capacity = this.nodeCapacities.get(nodeId)
    if (!capacity) return

    capacity.reservedCpuCores += resources.cpuCores
    capacity.reservedMemoryMB += resources.memoryMB
    capacity.reservedStorageGB += resources.storageGB
    capacity.reservedNetworkMbps += resources.networkMbps
    capacity.reservedGpuUnits += resources.gpuUnits
  }

  /**
   * Release capacity on node
   */
  private releaseCapacity(nodeId: string, resources: ReservedResources): void {
    const capacity = this.nodeCapacities.get(nodeId)
    if (!capacity) return

    capacity.reservedCpuCores = Math.max(0, capacity.reservedCpuCores - resources.cpuCores)
    capacity.reservedMemoryMB = Math.max(0, capacity.reservedMemoryMB - resources.memoryMB)
    capacity.reservedStorageGB = Math.max(0, capacity.reservedStorageGB - resources.storageGB)
    capacity.reservedNetworkMbps = Math.max(0, capacity.reservedNetworkMbps - resources.networkMbps)
    capacity.reservedGpuUnits = Math.max(0, capacity.reservedGpuUnits - resources.gpuUnits)
  }

  /**
   * Get reservation by ID
   */
  getReservation(reservationId: string): ResourceReservation | undefined {
    return this.reservations.get(reservationId)
  }

  /**
   * Get reservation by task ID
   */
  getReservationByTask(taskId: string): ResourceReservation | undefined {
    const reservationId = this.taskReservations.get(taskId)
    return reservationId ? this.reservations.get(reservationId) : undefined
  }

  /**
   * Cancel reservation
   */
  cancelReservation(reservationId: string, reason: string = 'user_cancel'): boolean {
    const reservation = this.reservations.get(reservationId)
    if (!reservation) return false

    reservation.status = 'cancelled'
    this.releaseCapacity(reservation.nodeId, reservation.resources)
    this.taskReservations.delete(reservation.taskId)

    this.emit('reservation.cancelled', { reservation, reason })
    logger.info('Reservation cancelled', { reservationId, reason })

    return true
  }

  /**
   * Preempt reservation (for higher priority)
   */
  preemptReservation(reservationId: string, higherPriorityTaskId: string): boolean {
    if (!this.config.preemptionEnabled) return false

    const reservation = this.reservations.get(reservationId)
    if (!reservation || reservation.guaranteed) return false

    reservation.status = 'cancelled'
    this.releaseCapacity(reservation.nodeId, reservation.resources)

    this.emit('reservation.preempted', { reservation, higherPriorityTaskId })
    logger.warn('Reservation preempted', { reservationId, higherPriorityTaskId })

    return true
  }

  /**
   * Activate pending reservations
   */
  activateReservations(): void {
    const now = Date.now()

    for (const reservation of this.reservations.values()) {
      if (reservation.status === 'pending' && reservation.startTime <= now) {
        reservation.status = 'active'
        this.emit('reservation.activated', reservation)
        logger.info('Reservation activated', { reservationId: reservation.id })
      }
    }
  }

  /**
   * Get node capacity info
   */
  getNodeCapacity(nodeId: string): NodeCapacity | undefined {
    return this.nodeCapacities.get(nodeId)
  }

  /**
   * Get available resources on node
   */
  getAvailableResources(nodeId: string): ReservedResources {
    const capacity = this.nodeCapacities.get(nodeId)
    if (!capacity) {
      return { cpuCores: 0, memoryMB: 0, storageGB: 0, networkMbps: 0, gpuUnits: 0 }
    }

    return {
      cpuCores: capacity.totalCpuCores - capacity.reservedCpuCores,
      memoryMB: capacity.totalMemoryMB - capacity.reservedMemoryMB,
      storageGB: capacity.totalStorageGB - capacity.reservedStorageGB,
      networkMbps: capacity.totalNetworkMbps - capacity.reservedNetworkMbps,
      gpuUnits: capacity.totalGpuUnits - capacity.reservedGpuUnits,
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalReservations: number
    activeReservations: number
    pendingReservations: number
    totalReservedCpu: number
    totalReservedMemory: number
    byPriority: Record<TaskPriority, number>
  } {
    const byPriority: Record<TaskPriority, number> = { critical: 0, high: 0, medium: 0, low: 0 }
    let active = 0
    let pending = 0
    let totalCpu = 0
    let totalMemory = 0

    for (const reservation of this.reservations.values()) {
      byPriority[reservation.priority]++
      if (reservation.status === 'active') active++
      if (reservation.status === 'pending') pending++
      totalCpu += reservation.resources.cpuCores
      totalMemory += reservation.resources.memoryMB
    }

    return {
      totalReservations: this.reservations.size,
      activeReservations: active,
      pendingReservations: pending,
      totalReservedCpu: totalCpu,
      totalReservedMemory: totalMemory,
      byPriority,
    }
  }

  /**
   * Start cleanup timer
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup()
      this.activateReservations()
    }, 10000)
  }

  /**
   * Cleanup expired reservations
   */
  private cleanup(): void {
    const now = Date.now()

    for (const [id, reservation] of this.reservations) {
      if (reservation.status === 'active' && reservation.endTime <= now) {
        reservation.status = 'completed'
        this.releaseCapacity(reservation.nodeId, reservation.resources)
        this.taskReservations.delete(reservation.taskId)
        logger.info('Reservation completed', { reservationId: id })
      }

      if (reservation.status === 'pending' && reservation.endTime <= now) {
        reservation.status = 'expired'
        this.releaseCapacity(reservation.nodeId, reservation.resources)
        this.taskReservations.delete(reservation.taskId)
        logger.warn('Reservation expired', { reservationId: id })
      }
    }
  }

  /**
   * Stop cleanup timer
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /**
   * Subscribe to events
   */
  on(event: ReservationEvent, callback: ReservationCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: ReservationEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Reservation callback error', error as Error)
      }
    })
  }
}

/**
 * Create resource reservation manager
 */
export function createResourceReservationManager(config: Partial<ReservationConfig> = {}): ResourceReservationManager {
  return new ResourceReservationManager(config)
}

// Default instance
export const resourceReservationManager = new ResourceReservationManager()
