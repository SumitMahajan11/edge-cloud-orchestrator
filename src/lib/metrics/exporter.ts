/**
 * Distributed Metrics Pipeline for Edge-Cloud Orchestrator
 * Exports Prometheus-compatible metrics for monitoring
 */

import { logger } from '../logger'
import type { EdgeNode, Task } from '../../types'

// Types
export interface MetricValue {
  name: string
  help: string
  type: 'counter' | 'gauge' | 'histogram' | 'summary'
  value: number
  labels: Record<string, string>
  timestamp: number
}

export interface HistogramBucket {
  le: string // Less than or equal
  count: number
}

export interface HistogramValue extends MetricValue {
  type: 'histogram'
  buckets: HistogramBucket[]
  sum: number
  count: number
}

export interface MetricsConfig {
  prefix: string
  defaultLabels: Record<string, string>
  collectInterval: number
  histogramBuckets: number[]
}

export interface ClusterMetrics {
  nodesTotal: number
  nodesOnline: number
  nodesOffline: number
  tasksTotal: number
  tasksPending: number
  tasksRunning: number
  tasksCompleted: number
  tasksFailed: number
  avgCpuUsage: number
  avgMemoryUsage: number
  avgLatency: number
  throughput: number // tasks per second
  successRate: number
}

type MetricsEvent = 'metric.recorded' | 'metric.exported' | 'alert.triggered'
type MetricsCallback = (event: MetricsEvent, data: unknown) => void

const DEFAULT_CONFIG: MetricsConfig = {
  prefix: 'edge_cloud',
  defaultLabels: {},
  collectInterval: 15000, // 15 seconds
  histogramBuckets: [0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
}

/**
 * Metrics Registry - Stores and manages metrics
 */
export class MetricsRegistry {
  private config: MetricsConfig
  private counters: Map<string, { value: number; labels: Record<string, string>; help: string }> = new Map()
  private gauges: Map<string, { value: number; labels: Record<string, string>; help: string }> = new Map()
  private histograms: Map<string, { 
    buckets: Map<string, number>
    sum: number
    count: number
    labels: Record<string, string>
    help: string
  }> = new Map()
  private callbacks: Map<MetricsEvent, Set<MetricsCallback>> = new Map()

  constructor(config: Partial<MetricsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Increment a counter
   */
  incrementCounter(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    const key = this.getMetricKey(name, labels)
    const existing = this.counters.get(key)
    
    if (existing) {
      existing.value += value
    } else {
      this.counters.set(key, {
        value,
        labels: { ...this.config.defaultLabels, ...labels },
        help: `Counter: ${name}`,
      })
    }

    this.emit('metric.recorded', { type: 'counter', name, value, labels })
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.getMetricKey(name, labels)
    
    this.gauges.set(key, {
      value,
      labels: { ...this.config.defaultLabels, ...labels },
      help: `Gauge: ${name}`,
    })

    this.emit('metric.recorded', { type: 'gauge', name, value, labels })
  }

  /**
   * Observe a value for histogram
   */
  observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.getMetricKey(name, labels)
    let histogram = this.histograms.get(key)
    
    if (!histogram) {
      histogram = {
        buckets: new Map(this.config.histogramBuckets.map(b => [b.toString(), 0])),
        sum: 0,
        count: 0,
        labels: { ...this.config.defaultLabels, ...labels },
        help: `Histogram: ${name}`,
      }
      this.histograms.set(key, histogram)
    }

    // Update buckets
    for (const bucket of this.config.histogramBuckets) {
      if (value <= bucket) {
        const current = histogram.buckets.get(bucket.toString()) || 0
        histogram.buckets.set(bucket.toString(), current + 1)
      }
    }
    // +Inf bucket
    histogram.buckets.set('+Inf', (histogram.buckets.get('+Inf') || 0) + 1)

    histogram.sum += value
    histogram.count++

    this.emit('metric.recorded', { type: 'histogram', name, value, labels })
  }

  /**
   * Get metric key with labels
   */
  private getMetricKey(name: string, labels: Record<string, string>): string {
    const sortedLabels = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',')
    
    return sortedLabels ? `${name}{${sortedLabels}}` : name
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheus(): string {
    const lines: string[] = []

    // Export counters
    for (const [key, counter] of this.counters) {
      const fullName = `${this.config.prefix}_${key.split('{')[0]}`
      lines.push(`# HELP ${fullName} ${counter.help}`)
      lines.push(`# TYPE ${fullName} counter`)
      
      const labelStr = Object.entries(counter.labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',')
      
      lines.push(`${fullName}{${labelStr}} ${counter.value}`)
    }

    // Export gauges
    for (const [key, gauge] of this.gauges) {
      const fullName = `${this.config.prefix}_${key.split('{')[0]}`
      lines.push(`# HELP ${fullName} ${gauge.help}`)
      lines.push(`# TYPE ${fullName} gauge`)
      
      const labelStr = Object.entries(gauge.labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',')
      
      lines.push(`${fullName}{${labelStr}} ${gauge.value}`)
    }

    // Export histograms
    for (const [key, histogram] of this.histograms) {
      const fullName = `${this.config.prefix}_${key.split('{')[0]}`
      lines.push(`# HELP ${fullName} ${histogram.help}`)
      lines.push(`# TYPE ${fullName} histogram`)

      const baseLabels = Object.entries(histogram.labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',')

      // Bucket values
      for (const [le, count] of histogram.buckets) {
        const labels = baseLabels ? `${baseLabels},le="${le}"` : `le="${le}"`
        lines.push(`${fullName}_bucket{${labels}} ${count}`)
      }

      // Sum and count
      if (baseLabels) {
        lines.push(`${fullName}_sum{${baseLabels}} ${histogram.sum}`)
        lines.push(`${fullName}_count{${baseLabels}} ${histogram.count}`)
      } else {
        lines.push(`${fullName}_sum ${histogram.sum}`)
        lines.push(`${fullName}_count ${histogram.count}`)
      }
    }

    return lines.join('\n')
  }

  /**
   * Export metrics as JSON
   */
  exportJSON(): { counters: unknown[]; gauges: unknown[]; histograms: unknown[] } {
    return {
      counters: Array.from(this.counters.entries()).map(([key, data]) => ({
        name: key,
        value: data.value,
        labels: data.labels,
      })),
      gauges: Array.from(this.gauges.entries()).map(([key, data]) => ({
        name: key,
        value: data.value,
        labels: data.labels,
      })),
      histograms: Array.from(this.histograms.entries()).map(([key, data]) => ({
        name: key,
        sum: data.sum,
        count: data.count,
        buckets: Array.from(data.buckets.entries()),
        labels: data.labels,
      })),
    }
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.counters.clear()
    this.gauges.clear()
    this.histograms.clear()
  }

  /**
   * Subscribe to events
   */
  on(event: MetricsEvent, callback: MetricsCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: MetricsEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Metrics callback error', error as Error)
      }
    })
  }
}

/**
 * Metrics Collector - Collects metrics from various sources
 */
export class MetricsCollector {
  private registry: MetricsRegistry
  private collectTimer: ReturnType<typeof setInterval> | null = null
  private nodeProvider: () => EdgeNode[]
  private taskProvider: () => Task[]

  constructor(
    registry: MetricsRegistry,
    nodeProvider: () => EdgeNode[] = () => [],
    taskProvider: () => Task[] = () => []
  ) {
    this.registry = registry
    this.nodeProvider = nodeProvider
    this.taskProvider = taskProvider
  }

  /**
   * Start collecting metrics
   */
  start(interval: number = 15000): void {
    if (this.collectTimer) {
      clearInterval(this.collectTimer)
    }

    // Collect immediately
    this.collect()

    // Then on interval
    this.collectTimer = setInterval(() => {
      this.collect()
    }, interval)

    logger.info('Metrics collector started', { interval })
  }

  /**
   * Stop collecting metrics
   */
  stop(): void {
    if (this.collectTimer) {
      clearInterval(this.collectTimer)
      this.collectTimer = null
    }
    logger.info('Metrics collector stopped')
  }

  /**
   * Collect all metrics
   */
  collect(): ClusterMetrics {
    const nodes = this.nodeProvider()
    const tasks = this.taskProvider()

    // Node metrics
    const nodesOnline = nodes.filter(n => n.status === 'online').length
    const nodesOffline = nodes.filter(n => n.status === 'offline').length
    const avgCpu = nodes.length > 0 
      ? nodes.reduce((sum, n) => sum + n.cpu, 0) / nodes.length 
      : 0
    const avgMemory = nodes.length > 0 
      ? nodes.reduce((sum, n) => sum + n.memory, 0) / nodes.length 
      : 0
    const avgLatency = nodes.length > 0 
      ? nodes.reduce((sum, n) => sum + (n.latency || 0), 0) / nodes.length 
      : 0

    // Task metrics
    const tasksPending = tasks.filter(t => t.status === 'pending').length
    const tasksRunning = tasks.filter(t => t.status === 'running').length
    const tasksCompleted = tasks.filter(t => t.status === 'completed').length
    const tasksFailed = tasks.filter(t => t.status === 'failed').length
    const totalTasks = tasks.length
    const successRate = totalTasks > 0 
      ? tasksCompleted / totalTasks 
      : 0

    // Update registry
    this.registry.setGauge('nodes_total', nodes.length)
    this.registry.setGauge('nodes_online', nodesOnline)
    this.registry.setGauge('nodes_offline', nodesOffline)
    this.registry.setGauge('node_cpu_avg', avgCpu)
    this.registry.setGauge('node_memory_avg', avgMemory)
    this.registry.setGauge('node_latency_avg_ms', avgLatency)

    this.registry.setGauge('tasks_total', totalTasks)
    this.registry.setGauge('tasks_pending', tasksPending)
    this.registry.setGauge('tasks_running', tasksRunning)
    this.registry.setGauge('tasks_completed', tasksCompleted)
    this.registry.setGauge('tasks_failed', tasksFailed)
    this.registry.setGauge('task_success_rate', successRate)

    // Per-node metrics
    for (const node of nodes) {
      const labels = { node_id: node.id, region: node.region || 'unknown' }
      this.registry.setGauge('node_cpu', node.cpu, labels)
      this.registry.setGauge('node_memory', node.memory, labels)
      this.registry.setGauge('node_latency_ms', node.latency || 0, labels)
      this.registry.setGauge('node_tasks_running', node.tasksRunning, labels)
    }

    return {
      nodesTotal: nodes.length,
      nodesOnline,
      nodesOffline,
      tasksTotal: totalTasks,
      tasksPending,
      tasksRunning,
      tasksCompleted,
      tasksFailed,
      avgCpuUsage: avgCpu,
      avgMemoryUsage: avgMemory,
      avgLatency,
      throughput: 0, // Would be calculated from historical data
      successRate,
    }
  }

  /**
   * Record task execution
   */
  recordTaskExecution(task: Task, duration: number, success: boolean): void {
    const labels = { 
      task_type: task.type, 
      priority: task.priority,
      target: task.target || 'edge',
    }

    this.registry.incrementCounter('task_executions_total', labels)
    
    if (success) {
      this.registry.incrementCounter('task_success_total', labels)
    } else {
      this.registry.incrementCounter('task_failure_total', labels)
    }

    this.registry.observeHistogram('task_duration_seconds', duration / 1000, labels)
  }

  /**
   * Record node heartbeat
   */
  recordNodeHeartbeat(nodeId: string, latency: number): void {
    this.registry.incrementCounter('node_heartbeats_total', { node_id: nodeId })
    this.registry.observeHistogram('node_heartbeat_latency_ms', latency, { node_id: nodeId })
  }
}

/**
 * Alert Manager - Triggers alerts based on metrics
 */
export interface AlertRule {
  name: string
  metric: string
  operator: '>' | '<' | '==' | '!=' | '>=' | '<='
  threshold: number
  duration: number // Duration in seconds before alerting
  severity: 'info' | 'warning' | 'critical'
  message: string
}

export class AlertManager {
  private registry: MetricsRegistry
  private rules: AlertRule[] = []
  private alertStates: Map<string, { triggeredAt: number | null; firing: boolean }> = new Map()

  constructor(registry: MetricsRegistry) {
    this.registry = registry
  }

  /**
   * Add alert rule
   */
  addRule(rule: AlertRule): void {
    this.rules.push(rule)
    this.alertStates.set(rule.name, { triggeredAt: null, firing: false })
  }

  /**
   * Evaluate all rules
   */
  evaluate(): Array<{ rule: AlertRule; firing: boolean; value: number }> {
    const results: Array<{ rule: AlertRule; firing: boolean; value: number }> = []

    for (const rule of this.rules) {
      const value = this.getMetricValue(rule.metric)
      const state = this.alertStates.get(rule.name)!
      const conditionMet = this.evaluateCondition(value, rule.operator, rule.threshold)

      if (conditionMet) {
        if (state.triggeredAt === null) {
          state.triggeredAt = Date.now()
        }

        const duration = (Date.now() - state.triggeredAt) / 1000
        
        if (duration >= rule.duration && !state.firing) {
          state.firing = true
          logger.warn(`Alert triggered: ${rule.name}`, { 
            metric: rule.metric, 
            value, 
            threshold: rule.threshold,
            severity: rule.severity 
          })
        }
      } else {
        if (state.firing) {
          logger.info(`Alert resolved: ${rule.name}`, { metric: rule.metric })
        }
        state.triggeredAt = null
        state.firing = false
      }

      results.push({ rule, firing: state.firing, value })
    }

    return results
  }

  private getMetricValue(metric: string): number {
    // Search in gauges first
    for (const [key, gauge] of this.registry['gauges']) {
      if (key.startsWith(metric)) {
        return gauge.value
      }
    }
    
    // Then in counters
    for (const [key, counter] of this.registry['counters']) {
      if (key.startsWith(metric)) {
        return counter.value
      }
    }
    
    return 0
  }

  private evaluateCondition(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case '>': return value > threshold
      case '<': return value < threshold
      case '==': return value === threshold
      case '!=': return value !== threshold
      case '>=': return value >= threshold
      case '<=': return value <= threshold
      default: return false
    }
  }
}

/**
 * Metrics Exporter - HTTP endpoint for Prometheus scraping
 */
export class MetricsExporter {
  private registry: MetricsRegistry

  constructor(registry: MetricsRegistry) {
    this.registry = registry
  }

  /**
   * Get Prometheus metrics response
   */
  getPrometheusMetrics(): { contentType: string; body: string } {
    return {
      contentType: 'text/plain; version=0.0.4; charset=utf-8',
      body: this.registry.exportPrometheus(),
    }
  }

  /**
   * Get JSON metrics response
   */
  getJSONMetrics(): { contentType: string; body: string } {
    return {
      contentType: 'application/json',
      body: JSON.stringify(this.registry.exportJSON(), null, 2),
    }
  }
}

// Factory functions
export function createMetricsRegistry(config: Partial<MetricsConfig> = {}): MetricsRegistry {
  return new MetricsRegistry(config)
}

export function createMetricsCollector(
  registry: MetricsRegistry,
  nodeProvider: () => EdgeNode[],
  taskProvider: () => Task[]
): MetricsCollector {
  return new MetricsCollector(registry, nodeProvider, taskProvider)
}

export function createAlertManager(registry: MetricsRegistry): AlertManager {
  return new AlertManager(registry)
}

export function createMetricsExporter(registry: MetricsRegistry): MetricsExporter {
  return new MetricsExporter(registry)
}

// Default instances
export const metricsRegistry = new MetricsRegistry()
export const metricsCollector = new MetricsCollector(metricsRegistry, () => [], () => [])
export const alertManager = new AlertManager(metricsRegistry)
export const metricsExporter = new MetricsExporter(metricsRegistry)

// Default alert rules
alertManager.addRule({
  name: 'high_cpu_usage',
  metric: 'node_cpu_avg',
  operator: '>',
  threshold: 80,
  duration: 60,
  severity: 'warning',
  message: 'Average CPU usage is above 80%',
})

alertManager.addRule({
  name: 'high_memory_usage',
  metric: 'node_memory_avg',
  operator: '>',
  threshold: 85,
  duration: 60,
  severity: 'warning',
  message: 'Average memory usage is above 85%',
})

alertManager.addRule({
  name: 'nodes_offline',
  metric: 'nodes_offline',
  operator: '>',
  threshold: 0,
  duration: 30,
  severity: 'critical',
  message: 'One or more nodes are offline',
})

alertManager.addRule({
  name: 'high_task_failure_rate',
  metric: 'task_failure_total',
  operator: '>',
  threshold: 10,
  duration: 120,
  severity: 'warning',
  message: 'High task failure rate detected',
})
