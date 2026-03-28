/**
 * Event Stream Architecture
 * Provides event sourcing and real-time event streaming
 */

import { logger } from '../logger'

// Types
export interface Event {
  id: string
  type: string
  aggregateId: string
  aggregateType: string
  version: number
  timestamp: number
  payload: unknown
  metadata: {
    correlationId?: string
    causationId?: string
    userId?: string
    source: string
  }
}

export interface EventSubscription {
  id: string
  eventType: string | RegExp
  callback: (event: Event) => Promise<void>
  filter?: (event: Event) => boolean
  createdAt: number
  active: boolean
}

export interface EventStreamConfig {
  maxEventsInMemory: number
  snapshotInterval: number
  retentionMs: number
  batchSize: number
}

export interface EventReplay {
  id: string
  fromVersion: number
  toVersion: number
  aggregateType?: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  processedCount: number
  startedAt?: number
  completedAt?: number
}

type EventStreamEvent = 'event.appended' | 'event.published' | 'subscription.added' | 'replay.started' | 'replay.completed'
type EventStreamCallback = (event: EventStreamEvent, data: unknown) => void

const DEFAULT_CONFIG: EventStreamConfig = {
  maxEventsInMemory: 10000,
  snapshotInterval: 100,
  retentionMs: 86400000, // 24 hours
  batchSize: 100,
}

/**
 * Event Store - Append-only log of all events
 */
export class EventStore {
  private config: EventStreamConfig
  private events: Event[] = []
  private eventIndex: Map<string, number> = new Map() // eventId -> index
  private aggregateVersions: Map<string, number> = new Map() // aggregateId -> version
  private subscriptions: Map<string, EventSubscription> = new Map()
  private projections: Map<string, (events: Event[]) => unknown> = new Map()
  private callbacks: Map<EventStreamEvent, Set<EventStreamCallback>> = new Map()
  private publisher: ((event: Event) => Promise<void>) | null = null

  constructor(config: Partial<EventStreamConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Set external publisher (e.g., Kafka, Redis Streams)
   */
  setPublisher(publisher: (event: Event) => Promise<void>): void {
    this.publisher = publisher
  }

  /**
   * Append event to store
   */
  async append(
    type: string,
    aggregateId: string,
    aggregateType: string,
    payload: unknown,
    metadata: Event['metadata']
  ): Promise<Event> {
    // Get current version
    const currentVersion = this.aggregateVersions.get(aggregateId) || 0
    const newVersion = currentVersion + 1

    const event: Event = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      aggregateId,
      aggregateType,
      version: newVersion,
      timestamp: Date.now(),
      payload,
      metadata: {
        ...metadata,
        source: metadata.source || 'event-store',
      },
    }

    // Append to store
    this.events.push(event)
    this.eventIndex.set(event.id, this.events.length - 1)
    this.aggregateVersions.set(aggregateId, newVersion)

    // Trim old events
    if (this.events.length > this.config.maxEventsInMemory) {
      const removed = this.events.length - this.config.maxEventsInMemory
      this.events = this.events.slice(removed)
      this.rebuildIndex()
    }

    this.emit('event.appended', event)
    logger.debug('Event appended', { eventId: event.id, type, aggregateId, version: newVersion })

    // Publish to subscribers
    await this.publish(event)

    return event
  }

  /**
   * Publish event to subscribers
   */
  private async publish(event: Event): Promise<void> {
    // External publisher
    if (this.publisher) {
      await this.publisher(event)
    }

    // Internal subscriptions
    const promises: Promise<void>[] = []

    for (const subscription of this.subscriptions.values()) {
      if (!subscription.active) continue

      // Check event type match
      const typeMatch = typeof subscription.eventType === 'string'
        ? subscription.eventType === event.type
        : subscription.eventType.test(event.type)

      if (!typeMatch) continue

      // Apply filter
      if (subscription.filter && !subscription.filter(event)) continue

      promises.push(subscription.callback(event))
    }

    await Promise.allSettled(promises)
    this.emit('event.published', { eventId: event.id, subscriberCount: promises.length })
  }

  /**
   * Subscribe to events
   */
  subscribe(
    eventType: string | RegExp,
    callback: (event: Event) => Promise<void>,
    filter?: (event: Event) => boolean
  ): string {
    const subscriptionId = `sub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    const subscription: EventSubscription = {
      id: subscriptionId,
      eventType,
      callback,
      filter,
      createdAt: Date.now(),
      active: true,
    }

    this.subscriptions.set(subscriptionId, subscription)
    this.emit('subscription.added', { subscriptionId, eventType: eventType.toString() })

    return subscriptionId
  }

  /**
   * Unsubscribe
   */
  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId)
  }

  /**
   * Get events for aggregate
   */
  getEvents(aggregateId: string, fromVersion: number = 0): Event[] {
    return this.events.filter(
      e => e.aggregateId === aggregateId && e.version > fromVersion
    )
  }

  /**
   * Get events by type
   */
  getEventsByType(type: string, limit: number = 100): Event[] {
    return this.events.filter(e => e.type === type).slice(-limit)
  }

  /**
   * Get events in time range
   */
  getEventsByTimeRange(start: number, end: number): Event[] {
    return this.events.filter(e => e.timestamp >= start && e.timestamp <= end)
  }

  /**
   * Replay events
   */
  async replay(
    fromVersion: number,
    toVersion: number,
    handler: (event: Event) => Promise<void>,
    aggregateType?: string
  ): Promise<EventReplay> {
    const replay: EventReplay = {
      id: `replay-${Date.now()}`,
      fromVersion,
      toVersion,
      aggregateType,
      status: 'running',
      processedCount: 0,
      startedAt: Date.now(),
    }

    this.emit('replay.started', replay)

    try {
      const events = this.events.filter(e => {
        if (e.version < fromVersion || e.version > toVersion) return false
        if (aggregateType && e.aggregateType !== aggregateType) return false
        return true
      })

      for (const event of events) {
        await handler(event)
        replay.processedCount++
      }

      replay.status = 'completed'
      replay.completedAt = Date.now()
    } catch (error) {
      replay.status = 'failed'
      logger.error('Event replay failed', error as Error, { replayId: replay.id })
    }

    this.emit('replay.completed', replay)
    return replay
  }

  /**
   * Register projection
   */
  registerProjection(name: string, projector: (events: Event[]) => unknown): void {
    this.projections.set(name, projector)
  }

  /**
   * Run projection
   */
  runProjection(name: string, aggregateId?: string): unknown {
    const projector = this.projections.get(name)
    if (!projector) return null

    const events = aggregateId
      ? this.getEvents(aggregateId)
      : this.events

    return projector(events)
  }

  /**
   * Rebuild index
   */
  private rebuildIndex(): void {
    this.eventIndex.clear()
    this.events.forEach((event, index) => {
      this.eventIndex.set(event.id, index)
    })
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalEvents: number
    totalAggregates: number
    totalSubscriptions: number
    oldestEvent: number | null
    newestEvent: number | null
  } {
    return {
      totalEvents: this.events.length,
      totalAggregates: this.aggregateVersions.size,
      totalSubscriptions: this.subscriptions.size,
      oldestEvent: this.events[0]?.timestamp || null,
      newestEvent: this.events[this.events.length - 1]?.timestamp || null,
    }
  }

  /**
   * Subscribe to stream events
   */
  on(event: EventStreamEvent, callback: EventStreamCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: EventStreamEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Event stream callback error', error as Error)
      }
    })
  }
}

/**
 * Event Types for the orchestrator
 */
export const EventTypes = {
  // Node events
  NODE_REGISTERED: 'node.registered',
  NODE_DEREGISTERED: 'node.deregistered',
  NODE_HEARTBEAT: 'node.heartbeat',
  NODE_STATUS_CHANGED: 'node.status_changed',
  
  // Task events
  TASK_CREATED: 'task.created',
  TASK_SCHEDULED: 'task.scheduled',
  TASK_STARTED: 'task.started',
  TASK_COMPLETED: 'task.completed',
  TASK_FAILED: 'task.failed',
  TASK_MIGRATED: 'task.migrated',
  
  // Scheduler events
  SCHEDULER_DECISION: 'scheduler.decision',
  SCHEDULER_POLICY_CHANGED: 'scheduler.policy_changed',
  
  // Cluster events
  LEADER_ELECTED: 'cluster.leader_elected',
  LEADER_DEMOTED: 'cluster.leader_demoted',
  
  // Alert events
  ALERT_TRIGGERED: 'alert.triggered',
  ALERT_RESOLVED: 'alert.resolved',
  
  // Recovery events
  FAILURE_DETECTED: 'recovery.failure_detected',
  RECOVERY_STARTED: 'recovery.started',
  RECOVERY_COMPLETED: 'recovery.completed',
} as const

/**
 * Event Builder - Helper for creating events
 */
export class EventBuilder {
  private type: string = ''
  private aggregateId: string = ''
  private aggregateType: string = ''
  private payload: unknown = null
  private metadata: Event['metadata'] = { source: 'unknown' }

  withType(type: string): this {
    this.type = type
    return this
  }

  forAggregate(id: string, type: string): this {
    this.aggregateId = id
    this.aggregateType = type
    return this
  }

  withPayload(payload: unknown): this {
    this.payload = payload
    return this
  }

  withMetadata(metadata: Partial<Event['metadata']>): this {
    this.metadata = { ...this.metadata, ...metadata }
    return this
  }

  withCorrelationId(id: string): this {
    this.metadata.correlationId = id
    return this
  }

  withSource(source: string): this {
    this.metadata.source = source
    return this
  }

  build(): { type: string; aggregateId: string; aggregateType: string; payload: unknown; metadata: Event['metadata'] } {
    return {
      type: this.type,
      aggregateId: this.aggregateId,
      aggregateType: this.aggregateType,
      payload: this.payload,
      metadata: this.metadata,
    }
  }
}

/**
 * Create event store
 */
export function createEventStore(config: Partial<EventStreamConfig> = {}): EventStore {
  return new EventStore(config)
}

/**
 * Create event builder
 */
export function event(): EventBuilder {
  return new EventBuilder()
}

// Default instance
export const eventStore = new EventStore()
