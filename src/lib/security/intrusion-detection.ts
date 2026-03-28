import { auditLogger } from '../auth/audit'
import type { AuditSeverity } from '../auth/audit'

interface SecurityEvent {
  type: string
  severity: AuditSeverity
  source: string
  details: Record<string, unknown>
  timestamp: number
}

interface DetectionRule {
  id: string
  name: string
  description: string
  severity: AuditSeverity
  condition: (event: SecurityEvent) => boolean
  cooldownMs: number
}

interface Alert {
  id: string
  ruleId: string
  severity: AuditSeverity
  message: string
  source: string
  timestamp: number
  acknowledged: boolean
  details: Record<string, unknown>
}

interface IDSStats {
  totalEvents: number
  alertsTriggered: number
  alertsBySeverity: Record<AuditSeverity, number>
  topSources: Array<{ source: string; count: number }>
}

class IntrusionDetectionSystem {
  private rules: Map<string, DetectionRule> = new Map()
  private alerts: Alert[] = []
  private eventHistory: SecurityEvent[] = []
  private lastTriggerTime: Map<string, number> = new Map()
  private maxHistorySize = 10000
  private maxAlerts = 1000
  private listeners: Set<(alert: Alert) => void> = new Set()

  constructor() {
    this.initializeDefaultRules()
  }

  private initializeDefaultRules(): void {
    // Brute force detection
    this.addRule({
      id: 'brute-force-auth',
      name: 'Brute Force Authentication',
      description: 'Multiple failed login attempts from same IP',
      severity: 'warning',
      condition: (event) => {
        if (event.type !== 'auth.failed') return false
        
        const recentEvents = this.getRecentEvents(300000) // 5 minutes
        const failedAuths = recentEvents.filter(
          e => e.type === 'auth.failed' && e.source === event.source
        )
        return failedAuths.length >= 5
      },
      cooldownMs: 300000, // 5 minutes
    })

    // Unusual access pattern
    this.addRule({
      id: 'unusual-access',
      name: 'Unusual Access Pattern',
      description: 'Access from new IP or unusual time',
      severity: 'info',
      condition: (event) => {
        if (!event.source) return false
        
        const hour = new Date().getHours()
        const isUnusualTime = hour < 6 || hour > 22
        
        const recentEvents = this.getRecentEvents(86400000) // 24 hours
        const fromSameSource = recentEvents.filter(
          e => e.source === event.source && e.type === event.type
        )
        
        return isUnusualTime && fromSameSource.length < 3
      },
      cooldownMs: 3600000, // 1 hour
    })

    // Privilege escalation attempt
    this.addRule({
      id: 'privilege-escalation',
      name: 'Privilege Escalation Attempt',
      description: 'Attempt to access admin resources without permission',
      severity: 'error',
      condition: (event) => {
        return event.type === 'permission.denied' && 
               event.details?.resource === 'admin'
      },
      cooldownMs: 60000, // 1 minute
    })

    // Rate limit violation
    this.addRule({
      id: 'rate-limit-violation',
      name: 'Rate Limit Violation',
      description: 'Multiple rate limit exceeded events',
      severity: 'warning',
      condition: (event) => {
        if (event.type !== 'rate.limit.exceeded') return false
        
        const recentEvents = this.getRecentEvents(60000) // 1 minute
        const violations = recentEvents.filter(
          e => e.type === 'rate.limit.exceeded' && e.source === event.source
        )
        return violations.length >= 3
      },
      cooldownMs: 60000, // 1 minute
    })

    // Suspicious API usage
    this.addRule({
      id: 'suspicious-api',
      name: 'Suspicious API Usage',
      description: 'Unusual API call patterns or parameters',
      severity: 'warning',
      condition: (event) => {
        if (event.type !== 'api.request') return false
        
        const details = event.details
        // Check for SQL injection patterns
        const sqlPatterns = /(\b(union|select|insert|update|delete|drop|create|alter)\b|--|;)/i
        const hasSQLInjection = Object.values(details).some(
          v => typeof v === 'string' && sqlPatterns.test(v)
        )
        
        // Check for path traversal
        const pathTraversal = /\.\.[\/\\]/
        const hasPathTraversal = Object.values(details).some(
          v => typeof v === 'string' && pathTraversal.test(v)
        )
        
        return hasSQLInjection || hasPathTraversal
      },
      cooldownMs: 60000, // 1 minute
    })

    // Certificate anomaly
    this.addRule({
      id: 'certificate-anomaly',
      name: 'Certificate Anomaly',
      description: 'Invalid or revoked certificate usage',
      severity: 'critical',
      condition: (event) => {
        return event.type === 'certificate.invalid' || 
               event.type === 'certificate.revoked'
      },
      cooldownMs: 0, // No cooldown for critical issues
    })
  }

  addRule(rule: DetectionRule): void {
    this.rules.set(rule.id, rule)
  }

  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId)
  }

  processEvent(event: SecurityEvent): Alert[] {
    // Store event
    this.eventHistory.push(event)
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift()
    }

    const triggeredAlerts: Alert[] = []

    // Check all rules
    for (const rule of this.rules.values()) {
      // Check cooldown
      const lastTrigger = this.lastTriggerTime.get(rule.id)
      if (lastTrigger && Date.now() - lastTrigger < rule.cooldownMs) {
        continue
      }

      // Check condition
      if (rule.condition(event)) {
        const alert = this.createAlert(rule, event)
        triggeredAlerts.push(alert)
        
        // Update cooldown
        this.lastTriggerTime.set(rule.id, Date.now())
        
        // Log to audit
        auditLogger.logSecurityAlert(
          rule.severity,
          rule.name,
          {
            ruleId: rule.id,
            source: event.source,
            details: event.details,
          },
          event.source
        )
      }
    }

    return triggeredAlerts
  }

  private createAlert(rule: DetectionRule, event: SecurityEvent): Alert {
    const alert: Alert = {
      id: this.generateAlertId(),
      ruleId: rule.id,
      severity: rule.severity,
      message: `${rule.name}: ${rule.description}`,
      source: event.source,
      timestamp: Date.now(),
      acknowledged: false,
      details: event.details,
    }

    this.alerts.push(alert)
    if (this.alerts.length > this.maxAlerts) {
      this.alerts.shift()
    }

    // Notify listeners
    this.listeners.forEach(listener => {
      try {
        listener(alert)
      } catch (error) {
        console.error('IDS listener error:', error)
      }
    })

    return alert
  }

  private generateAlertId(): string {
    return `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  private getRecentEvents(durationMs: number): SecurityEvent[] {
    const cutoff = Date.now() - durationMs
    return this.eventHistory.filter(e => e.timestamp >= cutoff)
  }

  getAlerts(
    options: {
      acknowledged?: boolean
      severity?: AuditSeverity[]
      since?: number
    } = {}
  ): Alert[] {
    return this.alerts.filter(alert => {
      if (options.acknowledged !== undefined && alert.acknowledged !== options.acknowledged) {
        return false
      }
      if (options.severity && !options.severity.includes(alert.severity)) {
        return false
      }
      if (options.since && alert.timestamp < options.since) {
        return false
      }
      return true
    })
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId)
    if (!alert) return false
    alert.acknowledged = true
    return true
  }

  acknowledgeAllAlerts(): number {
    let count = 0
    this.alerts.forEach(alert => {
      if (!alert.acknowledged) {
        alert.acknowledged = true
        count++
      }
    })
    return count
  }

  clearAlerts(): void {
    this.alerts = []
  }

  getStats(): IDSStats {
    const stats: IDSStats = {
      totalEvents: this.eventHistory.length,
      alertsTriggered: this.alerts.length,
      alertsBySeverity: { info: 0, warning: 0, error: 0, critical: 0 },
      topSources: [],
    }

    // Count by severity
    this.alerts.forEach(alert => {
      stats.alertsBySeverity[alert.severity]++
    })

    // Count by source
    const sourceCounts: Record<string, number> = {}
    this.alerts.forEach(alert => {
      sourceCounts[alert.source] = (sourceCounts[alert.source] || 0) + 1
    })

    stats.topSources = Object.entries(sourceCounts)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    return stats
  }

  subscribe(listener: (alert: Alert) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getRules(): DetectionRule[] {
    return Array.from(this.rules.values())
  }

  // Helper methods for common event types
  logAuthEvent(
    type: 'success' | 'failed' | 'mfa',
    source: string,
    details: Record<string, unknown> = {}
  ): void {
    this.processEvent({
      type: `auth.${type}`,
      severity: type === 'failed' ? 'warning' : 'info',
      source,
      details,
      timestamp: Date.now(),
    })
  }

  logAPIEvent(
    endpoint: string,
    source: string,
    details: Record<string, unknown> = {}
  ): void {
    this.processEvent({
      type: 'api.request',
      severity: 'info',
      source,
      details: { endpoint, ...details },
      timestamp: Date.now(),
    })
  }

  logPermissionDenied(
    resource: string,
    action: string,
    source: string,
    details: Record<string, unknown> = {}
  ): void {
    this.processEvent({
      type: 'permission.denied',
      severity: 'warning',
      source,
      details: { resource, action, ...details },
      timestamp: Date.now(),
    })
  }
}

// Singleton instance
export const intrusionDetection = new IntrusionDetectionSystem()

export { IntrusionDetectionSystem }
export type { SecurityEvent, DetectionRule, Alert, IDSStats }
