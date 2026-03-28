import { PrismaClient } from '@prisma/client'
import Redis from 'ioredis'
import type { Logger } from 'pino'

export interface SLATarget {
  id: string
  name: string
  metric: string
  target: number
  unit: string
  window: number // in seconds
  severity: 'critical' | 'high' | 'medium'
}

export interface SLAMetric {
  timestamp: number
  value: number
  labels: Record<string, string>
}

export interface SLAStatus {
  target: SLATarget
  current: number
  status: 'healthy' | 'warning' | 'breach'
  percentage: number
  trend: 'improving' | 'stable' | 'degrading'
}

const DEFAULT_SLA_TARGETS: SLATarget[] = [
  {
    id: 'availability',
    name: 'System Availability',
    metric: 'uptime',
    target: 99.9,
    unit: 'percent',
    window: 2592000, // 30 days
    severity: 'critical',
  },
  {
    id: 'api-latency-p99',
    name: 'API Latency (P99)',
    metric: 'latency',
    target: 500,
    unit: 'ms',
    window: 300, // 5 minutes
    severity: 'high',
  },
  {
    id: 'api-latency-p95',
    name: 'API Latency (P95)',
    metric: 'latency',
    target: 200,
    unit: 'ms',
    window: 300,
    severity: 'medium',
  },
  {
    id: 'task-success-rate',
    name: 'Task Success Rate',
    metric: 'task_success',
    target: 95,
    unit: 'percent',
    window: 3600, // 1 hour
    severity: 'high',
  },
  {
    id: 'node-availability',
    name: 'Node Availability',
    metric: 'node_uptime',
    target: 99.5,
    unit: 'percent',
    window: 86400, // 1 day
    severity: 'high',
  },
  {
    id: 'error-rate',
    name: 'Error Rate',
    metric: 'error_rate',
    target: 1,
    unit: 'percent',
    window: 300,
    severity: 'critical',
  },
]

export class SLAMonitor {
  private prisma: PrismaClient
  private redis: Redis
  private logger: Logger
  private targets: SLATarget[]

  constructor(prisma: PrismaClient, redis: Redis, logger: Logger, targets?: SLATarget[]) {
    this.prisma = prisma
    this.redis = redis
    this.logger = logger
    this.targets = targets || DEFAULT_SLA_TARGETS
  }

  /**
   * Record a metric for SLA calculation
   */
  async recordMetric(metric: string, value: number, labels: Record<string, string> = {}): Promise<void> {
    const timestamp = Date.now()
    const key = `sla:metrics:${metric}`

    // Store in Redis sorted set for time-series data
    await this.redis.zadd(key, timestamp, JSON.stringify({ value, labels, timestamp }))

    // Trim old data (keep last 30 days)
    const cutoff = timestamp - 30 * 24 * 60 * 60 * 1000
    await this.redis.zremrangebyscore(key, '-inf', cutoff)
  }

  /**
   * Get current SLA status for all targets
   */
  async getStatus(): Promise<SLAStatus[]> {
    const statuses: SLAStatus[] = []

    for (const target of this.targets) {
      const status = await this.getTargetStatus(target)
      statuses.push(status)
    }

    return statuses
  }

  /**
   * Get status for a specific SLA target
   */
  private async getTargetStatus(target: SLATarget): Promise<SLAStatus> {
    const now = Date.now()
    const windowStart = now - target.window * 1000

    let current: number
    let trend: 'improving' | 'stable' | 'degrading' = 'stable'

    switch (target.metric) {
      case 'uptime':
        current = await this.calculateUptime(windowStart, now)
        break
      case 'latency':
        current = await this.calculateLatency(windowStart, now, target.id.includes('p99') ? 99 : 95)
        break
      case 'task_success':
        current = await this.calculateTaskSuccessRate(windowStart, now)
        break
      case 'node_uptime':
        current = await this.calculateNodeUptime(windowStart, now)
        break
      case 'error_rate':
        current = await this.calculateErrorRate(windowStart, now)
        break
      default:
        current = 0
    }

    // Calculate trend (compare with previous window)
    const previousStart = windowStart - target.window * 1000
    let previous: number

    switch (target.metric) {
      case 'uptime':
        previous = await this.calculateUptime(previousStart, windowStart)
        break
      case 'latency':
        previous = await this.calculateLatency(previousStart, windowStart, target.id.includes('p99') ? 99 : 95)
        break
      default:
        previous = current
    }

    if (target.unit === 'percent') {
      trend = current > previous ? 'improving' : current < previous ? 'degrading' : 'stable'
    } else {
      // For latency and error rate, lower is better
      trend = current < previous ? 'improving' : current > previous ? 'degrading' : 'stable'
    }

    // Determine status
    let status: 'healthy' | 'warning' | 'breach'
    const percentage = target.unit === 'percent'
      ? (current / target.target) * 100
      : (target.target / current) * 100

    if (target.unit === 'percent') {
      if (current >= target.target) {
        status = 'healthy'
      } else if (current >= target.target * 0.95) {
        status = 'warning'
      } else {
        status = 'breach'
      }
    } else {
      // For latency/error rate, lower is better
      if (current <= target.target) {
        status = 'healthy'
      } else if (current <= target.target * 1.5) {
        status = 'warning'
      } else {
        status = 'breach'
      }
    }

    return {
      target,
      current,
      status,
      percentage,
      trend,
    }
  }

  private async calculateUptime(start: number, end: number): Promise<number> {
    // Get total time and downtime from metrics
    const totalTime = (end - start) / 1000
    const downtime = await this.getDowntimeSeconds(start, end)
    return ((totalTime - downtime) / totalTime) * 100
  }

  private async getDowntimeSeconds(start: number, end: number): Promise<number> {
    // Query from Redis or database
    const key = 'sla:downtime'
    const entries = await this.redis.zrangebyscore(key, start, end, 'WITHSCORES')
    // Sum downtime
    return entries.length * 10 // Simplified
  }

  private async calculateLatency(start: number, end: number, percentile: number): Promise<number> {
    const key = 'sla:metrics:latency'
    const entries = await this.redis.zrangebyscore(key, start, end)
    
    if (entries.length === 0) return 0

    const latencies = entries
      .map(e => JSON.parse(e).value)
      .sort((a, b) => a - b)

    const index = Math.ceil((percentile / 100) * latencies.length) - 1
    return latencies[index] || 0
  }

  private async calculateTaskSuccessRate(start: number, end: number): Promise<number> {
    const completed = await this.prisma.task.count({
      where: {
        status: 'COMPLETED',
      },
    })

    const failed = await this.prisma.task.count({
      where: {
        status: 'FAILED',
      },
    })

    const total = completed + failed
    return total > 0 ? (completed / total) * 100 : 100
  }

  private async calculateNodeUptime(start: number, end: number): Promise<number> {
    const onlineNodes = await this.prisma.edgeNode.count({
      where: { status: 'ONLINE' },
    })

    const totalNodes = await this.prisma.edgeNode.count()
    return totalNodes > 0 ? (onlineNodes / totalNodes) * 100 : 100
  }

  private async calculateErrorRate(start: number, end: number): Promise<number> {
    const key = 'sla:metrics:error_rate'
    const entries = await this.redis.zrangebyscore(key, start, end)

    if (entries.length === 0) return 0

    const sum = entries.reduce((acc, e) => acc + JSON.parse(e).value, 0)
    return sum / entries.length
  }

  /**
   * Generate SLA report
   */
  async generateReport(period: 'daily' | 'weekly' | 'monthly'): Promise<{
    period: string
    generatedAt: string
    targets: SLAStatus[]
    summary: {
      healthy: number
      warning: number
      breach: number
      overallScore: number
    }
  }> {
    const statuses = await this.getStatus()
    
    const healthy = statuses.filter(s => s.status === 'healthy').length
    const warning = statuses.filter(s => s.status === 'warning').length
    const breach = statuses.filter(s => s.status === 'breach').length

    const overallScore = statuses.reduce((sum, s) => {
      const weight = s.target.severity === 'critical' ? 3 : s.target.severity === 'high' ? 2 : 1
      const score = s.status === 'healthy' ? 100 : s.status === 'warning' ? 70 : 30
      return sum + score * weight
    }, 0) / statuses.reduce((sum, s) => {
      const weight = s.target.severity === 'critical' ? 3 : s.target.severity === 'high' ? 2 : 1
      return sum + weight
    }, 0)

    return {
      period,
      generatedAt: new Date().toISOString(),
      targets: statuses,
      summary: {
        healthy,
        warning,
        breach,
        overallScore,
      },
    }
  }
}
