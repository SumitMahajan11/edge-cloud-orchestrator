/**
 * Redis-based Leader Election for Distributed Edge-Cloud Orchestrator
 * Provides distributed locking for orchestrator cluster coordination
 */

import { logger } from '../logger'

// Types
export interface LeaderElectionConfig {
  nodeId: string
  redisUrl?: string
  key: string
  ttl: number // Lock TTL in milliseconds
  retryInterval: number // Retry interval for acquiring lock
  refreshInterval: number // Interval to refresh leadership
}

export interface LeaderState {
  isLeader: boolean
  leaderId: string | null
  term: number
  acquiredAt: number | null
  expiresAt: number | null
}

type LeaderEvent = 'elected' | 'demoted' | 'leader_changed' | 'error'
type LeaderCallback = (event: LeaderEvent, data: unknown) => void

const DEFAULT_CONFIG: Omit<LeaderElectionConfig, 'nodeId'> = {
  key: 'edge-cloud:leader',
  ttl: 10000, // 10 seconds
  retryInterval: 1000, // 1 second
  refreshInterval: 3000, // 3 seconds
}

/**
 * In-Memory Leader Election (for development/testing)
 */
class InMemoryLeaderElection {
  private static leaderId: string | null = null
  private static term = 0
  private static expiresAt = 0

  static tryAcquire(nodeId: string, ttl: number): boolean {
    const now = Date.now()
    
    if (this.leaderId === null || this.expiresAt < now) {
      this.leaderId = nodeId
      this.term++
      this.expiresAt = now + ttl
      return true
    }

    if (this.leaderId === nodeId) {
      this.expiresAt = now + ttl
      return true
    }

    return false
  }

  static release(nodeId: string): void {
    if (this.leaderId === nodeId) {
      this.leaderId = null
    }
  }

  static getLeader(): { leaderId: string | null; term: number; expiresAt: number } {
    return {
      leaderId: this.leaderId,
      term: this.term,
      expiresAt: this.expiresAt,
    }
  }
}

/**
 * Leader Election Manager
 */
export class LeaderElection {
  private config: LeaderElectionConfig
  private state: LeaderState = {
    isLeader: false,
    leaderId: null,
    term: 0,
    acquiredAt: null,
    expiresAt: null,
  }
  private redisClient: unknown = null
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setInterval> | null = null
  private callbacks: Map<LeaderEvent, Set<LeaderCallback>> = new Map()
  private isRunning = false
  private useRedis = false

  constructor(config: Partial<LeaderElectionConfig> & { nodeId: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Initialize and start leader election
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Leader election already running', { nodeId: this.config.nodeId })
      return
    }

    this.isRunning = true

    // Try to connect to Redis if URL provided
    if (this.config.redisUrl) {
      try {
        this.redisClient = await this.connectRedis(this.config.redisUrl)
        this.useRedis = true
        logger.info('Connected to Redis for leader election', { nodeId: this.config.nodeId })
      } catch (error) {
        logger.warn('Redis connection failed, using in-memory leader election', { error: (error as Error).message })
        this.useRedis = false
      }
    }

    // Start election process
    this.startElectionLoop()
    
    logger.info('Leader election started', { nodeId: this.config.nodeId })
  }

  /**
   * Stop leader election
   */
  async stop(): Promise<void> {
    this.isRunning = false

    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }

    if (this.retryTimer) {
      clearInterval(this.retryTimer)
      this.retryTimer = null
    }

    // Release leadership if we have it
    if (this.state.isLeader) {
      await this.releaseLeadership()
    }

    // Disconnect Redis
    if (this.redisClient) {
      await this.disconnectRedis()
    }

    logger.info('Leader election stopped', { nodeId: this.config.nodeId })
  }

  /**
   * Start election loop
   */
  private startElectionLoop(): void {
    // Try to acquire leadership immediately
    this.tryAcquireLeadership()

    // Set up retry loop
    this.retryTimer = setInterval(() => {
      if (!this.state.isLeader) {
        this.tryAcquireLeadership()
      }
    }, this.config.retryInterval)
  }

  /**
   * Try to acquire leadership
   */
  private async tryAcquireLeadership(): Promise<void> {
    try {
      let acquired = false

      if (this.useRedis && this.redisClient) {
        acquired = await this.acquireRedisLock()
      } else {
        acquired = InMemoryLeaderElection.tryAcquire(
          this.config.nodeId,
          this.config.ttl
        )
      }

      if (acquired && !this.state.isLeader) {
        this.becomeLeader()
      } else if (!acquired && this.state.isLeader) {
        // Lost leadership
        this.loseLeadership()
      }
    } catch (error) {
      logger.error('Leader election error', error as Error)
      this.emit('error', { error: (error as Error).message })
    }
  }

  /**
   * Become leader
   */
  private becomeLeader(): void {
    const now = Date.now()
    
    this.state = {
      isLeader: true,
      leaderId: this.config.nodeId,
      term: this.useRedis ? this.state.term + 1 : InMemoryLeaderElection.getLeader().term,
      acquiredAt: now,
      expiresAt: now + this.config.ttl,
    }

    // Start refresh loop
    this.refreshTimer = setInterval(() => {
      this.refreshLeadership()
    }, this.config.refreshInterval)

    this.emit('elected', { nodeId: this.config.nodeId, term: this.state.term })
    logger.info('Became leader', { nodeId: this.config.nodeId, term: this.state.term })
  }

  /**
   * Lose leadership
   */
  private loseLeadership(): void {
    const wasLeader = this.state.isLeader
    
    this.state = {
      isLeader: false,
      leaderId: null,
      term: this.state.term,
      acquiredAt: null,
      expiresAt: null,
    }

    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }

    if (wasLeader) {
      this.emit('demoted', { nodeId: this.config.nodeId })
      logger.warn('Lost leadership', { nodeId: this.config.nodeId })
    }
  }

  /**
   * Refresh leadership
   */
  private async refreshLeadership(): Promise<void> {
    if (!this.state.isLeader) return

    try {
      let refreshed = false

      if (this.useRedis && this.redisClient) {
        refreshed = await this.refreshRedisLock()
      } else {
        refreshed = InMemoryLeaderElection.tryAcquire(
          this.config.nodeId,
          this.config.ttl
        )
      }

      if (!refreshed) {
        this.loseLeadership()
      } else {
        this.state.expiresAt = Date.now() + this.config.ttl
      }
    } catch (error) {
      logger.error('Failed to refresh leadership', error as Error)
      this.loseLeadership()
    }
  }

  /**
   * Release leadership voluntarily
   */
  private async releaseLeadership(): Promise<void> {
    try {
      if (this.useRedis && this.redisClient) {
        await this.releaseRedisLock()
      } else {
        InMemoryLeaderElection.release(this.config.nodeId)
      }

      this.loseLeadership()
      logger.info('Released leadership voluntarily', { nodeId: this.config.nodeId })
    } catch (error) {
      logger.error('Failed to release leadership', error as Error)
    }
  }

  /**
   * Connect to Redis
   */
  private async connectRedis(url: string): Promise<unknown> {
    try {
      // @ts-expect-error - Optional dependency
      const { createClient } = await import('redis')
      
      const client = createClient({ url })
      await client.connect()
      
      return client
    } catch (error) {
      throw new Error(`Redis connection failed: ${(error as Error).message}`)
    }
  }

  /**
   * Disconnect from Redis
   */
  private async disconnectRedis(): Promise<void> {
    if (this.redisClient) {
      try {
        await (this.redisClient as { quit: () => Promise<void> }).quit()
      } catch (error) {
        logger.error('Redis disconnect error', error as Error)
      }
      this.redisClient = null
    }
  }

  /**
   * Acquire Redis lock using SET NX EX
   */
  private async acquireRedisLock(): Promise<boolean> {
    if (!this.redisClient) return false

    const client = this.redisClient as {
      set: (key: string, value: string, options: { NX: boolean; PX: number }) => Promise<string | null>
    }

    const result = await client.set(
      this.config.key,
      this.config.nodeId,
      { NX: true, PX: this.config.ttl }
    )

    return result === 'OK'
  }

  /**
   * Refresh Redis lock
   */
  private async refreshRedisLock(): Promise<boolean> {
    if (!this.redisClient) return false

    // Use Lua script for atomic refresh
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("PEXPIRE", KEYS[1], ARGV[2])
      else
        return 0
      end
    `

    const client = this.redisClient as {
      eval: (script: string, keys: string[], args: (string | number)[]) => Promise<number>
    }

    const result = await client.eval(script, [this.config.key], [this.config.nodeId, this.config.ttl])
    return result === 1
  }

  /**
   * Release Redis lock
   */
  private async releaseRedisLock(): Promise<void> {
    if (!this.redisClient) return

    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `

    const client = this.redisClient as {
      eval: (script: string, keys: string[], args: string[]) => Promise<number>
    }

    await client.eval(script, [this.config.key], [this.config.nodeId])
  }

  /**
   * Check if this node is the leader
   */
  isLeader(): boolean {
    return this.state.isLeader
  }

  /**
   * Get current leader state
   */
  getState(): LeaderState {
    return { ...this.state }
  }

  /**
   * Get current leader ID
   */
  getLeaderId(): string | null {
    if (this.useRedis) {
      return this.state.leaderId
    }
    return InMemoryLeaderElection.getLeader().leaderId
  }

  /**
   * Subscribe to events
   */
  on(event: LeaderEvent, callback: LeaderCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: LeaderEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Leader election callback error', error as Error)
      }
    })
  }
}

/**
 * Cluster Coordinator - Coordinates multiple orchestrator instances
 */
export class ClusterCoordinator {
  private leaderElection: LeaderElection
  private nodeId: string
  private onLeaderActions: Array<() => Promise<void>> = []
  private onFollowerActions: Array<() => Promise<void>> = []

  constructor(config: Partial<LeaderElectionConfig> & { nodeId: string }) {
    this.nodeId = config.nodeId
    this.leaderElection = new LeaderElection(config)
    
    // Set up event handlers
    this.leaderElection.on('elected', () => {
      this.executeLeaderActions()
    })

    this.leaderElection.on('demoted', () => {
      this.executeFollowerActions()
    })
  }

  /**
   * Start cluster coordination
   */
  async start(): Promise<void> {
    await this.leaderElection.start()
    logger.info('Cluster coordinator started', { nodeId: this.nodeId })
  }

  /**
   * Stop cluster coordination
   */
  async stop(): Promise<void> {
    await this.leaderElection.stop()
    logger.info('Cluster coordinator stopped', { nodeId: this.nodeId })
  }

  /**
   * Register action to run when becoming leader
   */
  onBecomeLeader(action: () => Promise<void>): void {
    this.onLeaderActions.push(action)
  }

  /**
   * Register action to run when becoming follower
   */
  onBecomeFollower(action: () => Promise<void>): void {
    this.onFollowerActions.push(action)
  }

  /**
   * Check if this node is the leader
   */
  isLeader(): boolean {
    return this.leaderElection.isLeader()
  }

  /**
   * Get current leader ID
   */
  getLeaderId(): string | null {
    return this.leaderElection.getLeaderId()
  }

  /**
   * Execute leader actions
   */
  private async executeLeaderActions(): Promise<void> {
    for (const action of this.onLeaderActions) {
      try {
        await action()
      } catch (error) {
        logger.error('Leader action failed', error as Error)
      }
    }
  }

  /**
   * Execute follower actions
   */
  private async executeFollowerActions(): Promise<void> {
    for (const action of this.onFollowerActions) {
      try {
        await action()
      } catch (error) {
        logger.error('Follower action failed', error as Error)
      }
    }
  }
}

// Factory functions
export function createLeaderElection(config: Partial<LeaderElectionConfig> & { nodeId: string }): LeaderElection {
  return new LeaderElection(config)
}

export function createClusterCoordinator(config: Partial<LeaderElectionConfig> & { nodeId: string }): ClusterCoordinator {
  return new ClusterCoordinator(config)
}

// Default instance
export const leaderElection = new LeaderElection({ nodeId: `node-${Date.now()}` })
