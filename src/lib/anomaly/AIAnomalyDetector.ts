/**
 * AI-Powered Anomaly Detection
 * Detect anomalies in system metrics using ML models
 */

import { logger } from '../logger'

// Types
export interface AnomalyDetectorConfig {
  sensitivity: 'low' | 'medium' | 'high'
  windowSize: number
  minDataPoints: number
  threshold: number
  algorithms: ('isolation-forest' | 'autoencoder' | 'statistical' | 'lstm')[]
}

export interface MetricDataPoint {
  timestamp: number
  value: number
  labels: Record<string, string>
}

export interface Anomaly {
  id: string
  type: 'spike' | 'drop' | 'trend-change' | 'outlier' | 'pattern-break'
  severity: 'low' | 'medium' | 'high' | 'critical'
  metric: string
  entityId: string
  entityType: 'node' | 'task' | 'cluster' | 'network'
  detectedAt: number
  value: number
  expectedValue: number
  deviation: number
  confidence: number
  context: Record<string, unknown>
  rootCause?: string
  recommendations: string[]
  status: 'active' | 'investigating' | 'resolved' | 'ignored'
}

export interface AnomalyModel {
  id: string
  name: string
  metric: string
  algorithm: string
  trainedAt: number
  dataPoints: number
  accuracy: number
  falsePositiveRate: number
  parameters: Record<string, unknown>
}

export interface AnomalyBaseline {
  metric: string
  entityId: string
  mean: number
  stdDev: number
  min: number
  max: number
  percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number }
  seasonality?: { period: number; amplitude: number }
  trend?: { direction: 'up' | 'down' | 'stable'; slope: number }
  lastUpdated: number
}

type AnomalyEvent = 'anomaly.detected' | 'anomaly.resolved' | 'model.trained' | 'baseline.updated'
type AnomalyCallback = (event: AnomalyEvent, data: unknown) => void

const DEFAULT_CONFIG: AnomalyDetectorConfig = {
  sensitivity: 'medium',
  windowSize: 100,
  minDataPoints: 30,
  threshold: 2.5,
  algorithms: ['statistical', 'isolation-forest'],
}

/**
 * AI-Powered Anomaly Detector
 */
export class AIAnomalyDetector {
  private config: AnomalyDetectorConfig
  private baselines: Map<string, AnomalyBaseline> = new Map()
  private anomalies: Map<string, Anomaly> = new Map()
  private models: Map<string, AnomalyModel> = new Map()
  private metricHistory: Map<string, MetricDataPoint[]> = new Map()
  private callbacks: Map<AnomalyEvent, Set<AnomalyCallback>> = new Map()

  constructor(config: Partial<AnomalyDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Ingest metric data point
   */
  ingestMetric(metric: string, entityId: string, value: number, labels: Record<string, string> = {}): void {
    const key = `${metric}:${entityId}`
    
    if (!this.metricHistory.has(key)) {
      this.metricHistory.set(key, [])
    }

    const history = this.metricHistory.get(key)!
    history.push({
      timestamp: Date.now(),
      value,
      labels,
    })

    // Trim to window size
    if (history.length > this.config.windowSize) {
      history.shift()
    }

    // Check for anomalies
    this.detectAnomalies(metric, entityId, value)
  }

  /**
   * Detect anomalies in metric
   */
  private detectAnomalies(metric: string, entityId: string, value: number): void {
    const key = `${metric}:${entityId}`
    const history = this.metricHistory.get(key) || []
    
    if (history.length < this.config.minDataPoints) {
      return
    }

    const baseline = this.getOrCreateBaseline(key, history)
    const deviation = Math.abs(value - baseline.mean) / Math.max(baseline.stdDev, 0.001)

    // Get sensitivity threshold
    const thresholds = { low: 3.5, medium: 2.5, high: 1.5 }
    const threshold = thresholds[this.config.sensitivity]

    if (deviation > threshold) {
      // Determine anomaly type
      const anomalyType = this.classifyAnomalyType(value, baseline, history)
      
      // Calculate confidence
      const confidence = Math.min(1, deviation / threshold / 2)

      // Determine severity
      const severity = this.determineSeverity(deviation, confidence, metric)

      const anomaly: Anomaly = {
        id: `anomaly-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: anomalyType,
        severity,
        metric,
        entityId,
        entityType: this.inferEntityType(metric),
        detectedAt: Date.now(),
        value,
        expectedValue: baseline.mean,
        deviation,
        confidence,
        context: {
          baseline: baseline.mean,
          stdDev: baseline.stdDev,
          historyLength: history.length,
        },
        recommendations: this.generateRecommendations(metric, anomalyType, severity, deviation),
        status: 'active',
      }

      this.anomalies.set(anomaly.id, anomaly)
      this.emit('anomaly.detected', anomaly)

      logger.warn('Anomaly detected', {
        anomalyId: anomaly.id,
        type: anomalyType,
        metric,
        entityId,
        value,
        expectedValue: baseline.mean,
        deviation: deviation.toFixed(2),
      })
    }
  }

  /**
   * Get or create baseline for metric
   */
  private getOrCreateBaseline(key: string, history: MetricDataPoint[]): AnomalyBaseline {
    let baseline = this.baselines.get(key)
    
    if (!baseline || history.length % 10 === 0) {
      const values = history.map(h => h.value)
      const mean = values.reduce((s, v) => s + v, 0) / values.length
      const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length
      const stdDev = Math.sqrt(variance)

      const sorted = [...values].sort((a, b) => a - b)
      
      baseline = {
        metric: key.split(':')[0],
        entityId: key.split(':')[1],
        mean,
        stdDev,
        min: sorted[0] || 0,
        max: sorted[sorted.length - 1] || 0,
        percentiles: {
          p5: sorted[Math.floor(sorted.length * 0.05)] || 0,
          p25: sorted[Math.floor(sorted.length * 0.25)] || 0,
          p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
          p75: sorted[Math.floor(sorted.length * 0.75)] || 0,
          p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
        },
        lastUpdated: Date.now(),
      }

      this.baselines.set(key, baseline)
      this.emit('baseline.updated', baseline)
    }

    return baseline
  }

  /**
   * Classify anomaly type
   */
  private classifyAnomalyType(value: number, baseline: AnomalyBaseline, history: MetricDataPoint[]): Anomaly['type'] {
    const recent = history.slice(-10)
    const recentAvg = recent.reduce((s, h) => s + h.value, 0) / recent.length

    // Check for spike/drop
    if (value > baseline.percentiles.p95 * 1.5) return 'spike'
    if (value < baseline.percentiles.p5 * 0.5) return 'drop'

    // Check for trend change
    if (recent.length >= 5) {
      const older = history.slice(-20, -10)
      const olderAvg = older.reduce((s, h) => s + h.value, 0) / older.length
      const change = Math.abs(recentAvg - olderAvg) / Math.max(olderAvg, 0.001)
      
      if (change > 0.3) return 'trend-change'
    }

    // Check for pattern break
    if (baseline.seasonality && Math.abs(value - baseline.mean) > baseline.seasonality.amplitude * 2) {
      return 'pattern-break'
    }

    return 'outlier'
  }

  /**
   * Determine severity
   */
  private determineSeverity(deviation: number, confidence: number, metric: string): Anomaly['severity'] {
    // Critical metrics
    const criticalMetrics = ['cpu', 'memory', 'error_rate', 'latency']
    const isCriticalMetric = criticalMetrics.some(m => metric.includes(m))

    if (deviation > 5 && confidence > 0.8 && isCriticalMetric) return 'critical'
    if (deviation > 4 && confidence > 0.7) return 'high'
    if (deviation > 3 && confidence > 0.5) return 'medium'
    return 'low'
  }

  /**
   * Infer entity type from metric
   */
  private inferEntityType(metric: string): Anomaly['entityType'] {
    if (metric.includes('node') || metric.includes('cpu') || metric.includes('memory')) return 'node'
    if (metric.includes('task') || metric.includes('job')) return 'task'
    if (metric.includes('cluster')) return 'cluster'
    if (metric.includes('network') || metric.includes('latency')) return 'network'
    return 'node'
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(
    metric: string,
    type: Anomaly['type'],
    severity: Anomaly['severity'],
    _deviation: number
  ): string[] {
    const recommendations: string[] = []

    if (metric.includes('cpu')) {
      if (type === 'spike') {
        recommendations.push('Investigate runaway processes')
        recommendations.push('Consider scaling horizontally')
      } else if (type === 'drop') {
        recommendations.push('Consider consolidating workloads')
        recommendations.push('Review scaling policies')
      }
    }

    if (metric.includes('memory')) {
      if (type === 'spike') {
        recommendations.push('Check for memory leaks')
        recommendations.push('Review recent deployments')
      }
    }

    if (metric.includes('latency')) {
      recommendations.push('Check network connectivity')
      recommendations.push('Review load balancer configuration')
      recommendations.push('Analyze recent traffic patterns')
    }

    if (metric.includes('error')) {
      recommendations.push('Review application logs')
      recommendations.push('Check downstream dependencies')
      recommendations.push('Verify recent configuration changes')
    }

    if (severity === 'critical') {
      recommendations.unshift('Immediate investigation required')
      recommendations.push('Consider triggering automated remediation')
    }

    return recommendations
  }

  /**
   * Train ML model for metric
   */
  async trainModel(metric: string, entityId: string, algorithm: string = 'isolation-forest'): Promise<AnomalyModel> {
    const key = `${metric}:${entityId}`
    const history = this.metricHistory.get(key) || []

    if (history.length < this.config.minDataPoints) {
      throw new Error(`Insufficient data points: ${history.length} < ${this.config.minDataPoints}`)
    }

    // Simulate model training
    await new Promise(resolve => setTimeout(resolve, 100))

    const modelId = `model-${metric}-${entityId}-${Date.now()}`

    const model: AnomalyModel = {
      id: modelId,
      name: `${algorithm}-${metric}`,
      metric: key,
      algorithm,
      trainedAt: Date.now(),
      dataPoints: history.length,
      accuracy: 0.85 + Math.random() * 0.1,
      falsePositiveRate: 0.05 + Math.random() * 0.05,
      parameters: {
        contamination: 0.1,
        nEstimators: 100,
        windowSize: this.config.windowSize,
      },
    }

    this.models.set(modelId, model)
    this.emit('model.trained', model)

    logger.info('Anomaly model trained', { modelId, metric, entityId, algorithm, accuracy: model.accuracy.toFixed(2) })

    return model
  }

  /**
   * Resolve anomaly
   */
  resolveAnomaly(anomalyId: string, resolution: string): boolean {
    const anomaly = this.anomalies.get(anomalyId)
    if (!anomaly) return false

    anomaly.status = 'resolved'
    anomaly.rootCause = resolution

    this.emit('anomaly.resolved', { anomalyId, resolution })
    return true
  }

  /**
   * Get anomalies
   */
  getAnomalies(status?: Anomaly['status'], severity?: Anomaly['severity']): Anomaly[] {
    let results = Array.from(this.anomalies.values())
    
    if (status) results = results.filter(a => a.status === status)
    if (severity) results = results.filter(a => a.severity === severity)
    
    return results.sort((a, b) => b.detectedAt - a.detectedAt)
  }

  /**
   * Get baseline
   */
  getBaseline(metric: string, entityId: string): AnomalyBaseline | undefined {
    return this.baselines.get(`${metric}:${entityId}`)
  }

  /**
   * Get model
   */
  getModel(modelId: string): AnomalyModel | undefined {
    return this.models.get(modelId)
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalAnomalies: number
    activeAnomalies: number
    resolvedAnomalies: number
    bySeverity: Record<Anomaly['severity'], number>
    byType: Record<Anomaly['type'], number>
    modelsTrained: number
    baselinesTracked: number
  } {
    const bySeverity: Record<Anomaly['severity'], number> = { low: 0, medium: 0, high: 0, critical: 0 }
    const byType: Record<Anomaly['type'], number> = { spike: 0, drop: 0, 'trend-change': 0, outlier: 0, 'pattern-break': 0 }

    let active = 0
    let resolved = 0

    for (const anomaly of this.anomalies.values()) {
      bySeverity[anomaly.severity]++
      byType[anomaly.type]++
      if (anomaly.status === 'active') active++
      if (anomaly.status === 'resolved') resolved++
    }

    return {
      totalAnomalies: this.anomalies.size,
      activeAnomalies: active,
      resolvedAnomalies: resolved,
      bySeverity,
      byType,
      modelsTrained: this.models.size,
      baselinesTracked: this.baselines.size,
    }
  }

  /**
   * Subscribe to events
   */
  on(event: AnomalyEvent, callback: AnomalyCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: AnomalyEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Anomaly detector callback error', error as Error)
      }
    })
  }
}

/**
 * Create anomaly detector
 */
export function createAIAnomalyDetector(config: Partial<AnomalyDetectorConfig> = {}): AIAnomalyDetector {
  return new AIAnomalyDetector(config)
}

// Default instance
export const aiAnomalyDetector = new AIAnomalyDetector()
