interface MetricValue {
  value: number
  timestamp: number
  labels: Record<string, string>
}

interface Counter {
  name: string
  help: string
  values: Map<string, MetricValue>
}

interface Gauge {
  name: string
  help: string
  values: Map<string, MetricValue>
}

interface Histogram {
  name: string
  help: string
  buckets: number[]
  values: Map<string, { count: number; sum: number; buckets: Map<number, number> }>
}

type MetricType = 'counter' | 'gauge' | 'histogram'

class MetricsRegistry {
  private counters: Map<string, Counter> = new Map()
  private gauges: Map<string, Gauge> = new Map()
  private histograms: Map<string, Histogram> = new Map()

  // Counter operations
  createCounter(name: string, help: string, _labelNames: string[] = []): Counter {
    const counter: Counter = {
      name,
      help,
      values: new Map(),
    }
    this.counters.set(name, counter)
    return counter
  }

  incCounter(name: string, labels: Record<string, string> = {}, value = 1): void {
    const counter = this.counters.get(name)
    if (!counter) {
      console.warn(`Counter ${name} not found`)
      return
    }

    const labelKey = this.serializeLabels(labels)
    const existing = counter.values.get(labelKey)

    if (existing) {
      existing.value += value
      existing.timestamp = Date.now()
    } else {
      counter.values.set(labelKey, {
        value,
        timestamp: Date.now(),
        labels,
      })
    }
  }

  // Gauge operations
  createGauge(name: string, help: string, _labelNames: string[] = []): Gauge {
    const gauge: Gauge = {
      name,
      help,
      values: new Map(),
    }
    this.gauges.set(name, gauge)
    return gauge
  }

  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const gauge = this.gauges.get(name)
    if (!gauge) {
      console.warn(`Gauge ${name} not found`)
      return
    }

    const labelKey = this.serializeLabels(labels)
    gauge.values.set(labelKey, {
      value,
      timestamp: Date.now(),
      labels,
    })
  }

  incGauge(name: string, value = 1, labels: Record<string, string> = {}): void {
    const gauge = this.gauges.get(name)
    if (!gauge) return

    const labelKey = this.serializeLabels(labels)
    const existing = gauge.values.get(labelKey)

    if (existing) {
      existing.value += value
      existing.timestamp = Date.now()
    } else {
      gauge.values.set(labelKey, {
        value,
        timestamp: Date.now(),
        labels,
      })
    }
  }

  decGauge(name: string, value = 1, labels: Record<string, string> = {}): void {
    this.incGauge(name, -value, labels)
  }

  // Histogram operations
  createHistogram(
    name: string,
    help: string,
    buckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    _labelNames: string[] = []
  ): Histogram {
    const histogram: Histogram = {
      name,
      help,
      buckets,
      values: new Map(),
    }
    this.histograms.set(name, histogram)
    return histogram
  }

  observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const histogram = this.histograms.get(name)
    if (!histogram) {
      console.warn(`Histogram ${name} not found`)
      return
    }

    const labelKey = this.serializeLabels(labels)
    let existing = histogram.values.get(labelKey)

    if (!existing) {
      existing = {
        count: 0,
        sum: 0,
        buckets: new Map(),
      }
      histogram.values.set(labelKey, existing)
    }

    existing.count++
    existing.sum += value

    // Update buckets
    for (const bucket of histogram.buckets) {
      if (value <= bucket) {
        existing.buckets.set(bucket, (existing.buckets.get(bucket) || 0) + 1)
      }
    }
  }

  // Prometheus format export
  toPrometheusFormat(): string {
    const lines: string[] = []

    // Counters
    for (const counter of this.counters.values()) {
      lines.push(`# HELP ${counter.name} ${counter.help}`)
      lines.push(`# TYPE ${counter.name} counter`)
      for (const [, value] of counter.values) {
        const labels = this.formatLabels(value.labels)
        lines.push(`${counter.name}${labels} ${value.value} ${value.timestamp}`)
      }
      lines.push('')
    }

    // Gauges
    for (const gauge of this.gauges.values()) {
      lines.push(`# HELP ${gauge.name} ${gauge.help}`)
      lines.push(`# TYPE ${gauge.name} gauge`)
      for (const [, value] of gauge.values) {
        const labels = this.formatLabels(value.labels)
        lines.push(`${gauge.name}${labels} ${value.value} ${value.timestamp}`)
      }
      lines.push('')
    }

    // Histograms
    for (const histogram of this.histograms.values()) {
      lines.push(`# HELP ${histogram.name} ${histogram.help}`)
      lines.push(`# TYPE ${histogram.name} histogram`)

      for (const [labelKey, data] of histogram.values) {
        // Build label string from labelKey (format: "key1=value1,key2=value2")
        const labelStr = labelKey ? `{${labelKey.replace(/,/g, ',').replace(/=/g, '="')}"}}` : ''

        // Bucket counts
        for (const bucket of histogram.buckets) {
          const bucketValue = data.buckets.get(bucket) || 0
          lines.push(`${histogram.name}_bucket{le="${bucket}"${labelKey ? ',' + labelKey : ''}} ${bucketValue}`)
        }

        // +Inf bucket
        lines.push(`${histogram.name}_bucket{le="+Inf"${labelKey ? ',' + labelKey : ''}} ${data.count}`)

        lines.push(`${histogram.name}_sum${labelStr} ${data.sum}`)
        lines.push(`${histogram.name}_count${labelStr} ${data.count}`)
      }
      lines.push('')
    }

    return lines.join('\n')
  }

  private serializeLabels(labels: Record<string, string>): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',')
  }

  private formatLabels(labels: Record<string, string>): string {
    const entries = Object.entries(labels)
    if (entries.length === 0) return ''

    const formatted = entries
      .map(([k, v]) => `${k}="${v}"`)
      .join(',')

    return `{${formatted}}`
  }

  // Get metric value
  getMetric(name: string, type: MetricType, labels: Record<string, string> = {}): number | null {
    const labelKey = this.serializeLabels(labels)

    switch (type) {
      case 'counter': {
        const counter = this.counters.get(name)
        return counter?.values.get(labelKey)?.value ?? null
      }
      case 'gauge': {
        const gauge = this.gauges.get(name)
        return gauge?.values.get(labelKey)?.value ?? null
      }
      case 'histogram': {
        const histogram = this.histograms.get(name)
        return histogram?.values.get(labelKey)?.count ?? null
      }
      default:
        return null
    }
  }

  // Clear all metrics
  clear(): void {
    this.counters.clear()
    this.gauges.clear()
    this.histograms.clear()
  }

  // Get all metric names
  getMetricNames(): { counters: string[]; gauges: string[]; histograms: string[] } {
    return {
      counters: Array.from(this.counters.keys()),
      gauges: Array.from(this.gauges.keys()),
      histograms: Array.from(this.histograms.keys()),
    }
  }
}

// Predefined metrics
const metricsRegistry = new MetricsRegistry()

// System metrics
metricsRegistry.createGauge('edgecloud_nodes_total', 'Total number of edge nodes', ['status'])
metricsRegistry.createGauge('edgecloud_nodes_cpu_usage', 'CPU usage percentage', ['node_id'])
metricsRegistry.createGauge('edgecloud_nodes_memory_usage', 'Memory usage percentage', ['node_id'])

// Task metrics
metricsRegistry.createCounter('edgecloud_tasks_submitted_total', 'Total tasks submitted', ['type', 'priority'])
metricsRegistry.createCounter('edgecloud_tasks_completed_total', 'Total tasks completed', ['type', 'status'])
metricsRegistry.createGauge('edgecloud_tasks_running', 'Currently running tasks')
metricsRegistry.createHistogram('edgecloud_task_duration_seconds', 'Task execution duration')

// API metrics
metricsRegistry.createCounter('edgecloud_api_requests_total', 'Total API requests', ['method', 'endpoint', 'status'])
metricsRegistry.createHistogram('edgecloud_api_request_duration_seconds', 'API request duration', [0.01, 0.05, 0.1, 0.5, 1, 2, 5])

// Security metrics
metricsRegistry.createCounter('edgecloud_auth_attempts_total', 'Authentication attempts', ['status'])
metricsRegistry.createCounter('edgecloud_security_alerts_total', 'Security alerts triggered', ['severity'])

export { MetricsRegistry, metricsRegistry }
export type { MetricValue, Counter, Gauge, Histogram, MetricType }
