import { generateId } from '../utils'
import type { UserSession } from './rbac'

type AuditEventType = 
  | 'auth.login'
  | 'auth.logout'
  | 'auth.mfa'
  | 'auth.failed'
  | 'node.create'
  | 'node.update'
  | 'node.delete'
  | 'node.execute'
  | 'task.create'
  | 'task.update'
  | 'task.delete'
  | 'task.execute'
  | 'policy.change'
  | 'webhook.create'
  | 'webhook.delete'
  | 'user.create'
  | 'user.update'
  | 'user.delete'
  | 'permission.denied'
  | 'security.alert'
  | 'config.change'
  | 'certificate.create'
  | 'certificate.revoke'

type AuditSeverity = 'info' | 'warning' | 'error' | 'critical'

interface AuditEvent {
  id: string
  timestamp: number
  eventType: AuditEventType
  severity: AuditSeverity
  userId?: string
  userEmail?: string
  sessionId?: string
  ipAddress: string
  userAgent: string
  resource: string
  action: string
  status: 'success' | 'failure'
  details: Record<string, unknown>
  changes?: {
    before: Record<string, unknown>
    after: Record<string, unknown>
  }
  metadata?: {
    requestId: string
    correlationId: string
    duration: number
  }
}

interface AuditFilter {
  eventTypes?: AuditEventType[]
  severity?: AuditSeverity[]
  userId?: string
  resource?: string
  startTime?: number
  endTime?: number
  status?: 'success' | 'failure'
}

class AuditLogger {
  private events: AuditEvent[] = []
  private maxEvents = 10000
  private listeners: Set<(event: AuditEvent) => void> = new Set()

  log(event: Omit<AuditEvent, 'id' | 'timestamp'>): AuditEvent {
    const fullEvent: AuditEvent = {
      ...event,
      id: generateId(),
      timestamp: Date.now(),
    }

    this.events.push(fullEvent)

    // Trim old events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents)
    }

    // Notify listeners
    this.listeners.forEach(listener => {
      try {
        listener(fullEvent)
      } catch (error) {
        console.error('Audit listener error:', error)
      }
    })

    return fullEvent
  }

  logAuth(
    eventType: 'auth.login' | 'auth.logout' | 'auth.mfa' | 'auth.failed',
    session: UserSession | null,
    ipAddress: string,
    userAgent: string,
    status: 'success' | 'failure',
    details: Record<string, unknown> = {}
  ): AuditEvent {
    return this.log({
      eventType,
      severity: eventType === 'auth.failed' ? 'warning' : 'info',
      userId: session?.userId,
      userEmail: session?.email,
      ipAddress,
      userAgent,
      resource: 'auth',
      action: eventType.split('.')[1],
      status,
      details,
    })
  }

  logResourceAccess(
    eventType: AuditEventType,
    session: UserSession,
    resource: string,
    action: string,
    status: 'success' | 'failure',
    details: Record<string, unknown> = {},
    changes?: { before: Record<string, unknown>; after: Record<string, unknown> }
  ): AuditEvent {
    return this.log({
      eventType,
      severity: status === 'failure' ? 'warning' : 'info',
      userId: session.userId,
      userEmail: session.email,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      resource,
      action,
      status,
      details,
      changes,
    })
  }

  logSecurityAlert(
    severity: AuditSeverity,
    alertType: string,
    details: Record<string, unknown>,
    ipAddress: string = 'unknown'
  ): AuditEvent {
    return this.log({
      eventType: 'security.alert',
      severity,
      ipAddress,
      userAgent: 'system',
      resource: 'security',
      action: 'alert',
      status: 'failure',
      details: {
        alertType,
        ...details,
      },
    })
  }

  query(filter: AuditFilter): AuditEvent[] {
    return this.events.filter(event => {
      if (filter.eventTypes && !filter.eventTypes.includes(event.eventType)) {
        return false
      }
      if (filter.severity && !filter.severity.includes(event.severity)) {
        return false
      }
      if (filter.userId && event.userId !== filter.userId) {
        return false
      }
      if (filter.resource && event.resource !== filter.resource) {
        return false
      }
      if (filter.startTime && event.timestamp < filter.startTime) {
        return false
      }
      if (filter.endTime && event.timestamp > filter.endTime) {
        return false
      }
      if (filter.status && event.status !== filter.status) {
        return false
      }
      return true
    })
  }

  getRecentEvents(count: number = 100): AuditEvent[] {
    return this.events.slice(-count).reverse()
  }

  getEventsByUser(userId: string): AuditEvent[] {
    return this.events.filter(e => e.userId === userId)
  }

  getEventsByResource(resource: string): AuditEvent[] {
    return this.events.filter(e => e.resource === resource)
  }

  getSecurityEvents(): AuditEvent[] {
    return this.events.filter(
      e => e.severity === 'error' || e.severity === 'critical' || e.eventType === 'security.alert'
    )
  }

  subscribe(listener: (event: AuditEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  export(filter?: AuditFilter): string {
    const events = filter ? this.query(filter) : this.events
    return JSON.stringify(events, null, 2)
  }

  clear(): void {
    this.events = []
  }

  getStats(): {
    totalEvents: number
    bySeverity: Record<AuditSeverity, number>
    byType: Record<string, number>
    byUser: Record<string, number>
  } {
    const stats = {
      totalEvents: this.events.length,
      bySeverity: { info: 0, warning: 0, error: 0, critical: 0 },
      byType: {} as Record<string, number>,
      byUser: {} as Record<string, number>,
    }

    this.events.forEach(event => {
      stats.bySeverity[event.severity]++
      stats.byType[event.eventType] = (stats.byType[event.eventType] || 0) + 1
      if (event.userId) {
        stats.byUser[event.userId] = (stats.byUser[event.userId] || 0) + 1
      }
    })

    return stats
  }
}

// Singleton instance
export const auditLogger = new AuditLogger()

export { AuditLogger }
export type { AuditEvent, AuditEventType, AuditSeverity, AuditFilter }
