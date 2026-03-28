interface MetricValue {
  value: number
  timestamp: number
  labels: Record<string, string>
}

interface MetricDefinition {
  name: string
  help: string
  type: 'counter' | 'gauge' | 'histogram' | 'summary'
}

class PrometheusMetrics {
  private metrics: Map<string, MetricDefinition> = new Map()
  private values: Map<string, MetricValue[]> = new Map()
  private histogramBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

  register(definition: MetricDefinition): void {
    this.metrics.set(definition.name, definition)
    if (!this.values.has(definition.name)) {
      this.values.set(definition.name, [])
    }
  }

  counter(name: string, labels: Record<string, string> = {}, value = 1): void {
    const def = this.metrics.get(name)
    if (!def) {
      console.warn(`Metric ${name} not registered`)
      return
    }

    // const key = this.getLabelKey(name, labels)  // Reserved for future use
    const values = this.values.get(name) || []
    const existing = values.find(v => this.labelsMatch(v.labels, labels))

    if (existing) {
      existing.value += value
      existing.timestamp = Date.now()
    } else {
      values.push({ value, timestamp: Date.now(), labels })
    }

    this.values.set(name, values)
  }

  gauge(name: string, labels: Record<string, string> = {}, value: number): void {
    const def = this.metrics.get(name)
    if (!def) {
      console.warn(`Metric ${name} not registered`)
      return
    }

    const values = this.values.get(name) || []
    const existing = values.find(v => this.labelsMatch(v.labels, labels))

    if (existing) {
      existing.value = value
      existing.timestamp = Date.now()
    } else {
      values.push({ value, timestamp: Date.now(), labels })
    }

    this.values.set(name, values)
  }

  histogram(name: string, labels: Record<string, string> = {}, value: number): void {
    const def = this.metrics.get(name)
    if (!def) {
      console.warn(`Metric ${name} not registered`)
      return
    }

    const key = `${name}_bucket`
    const values = this.values.get(key) || []

    // Create bucket counters
    for (const bucket of this.histogramBuckets) {
      const bucketLabels = { ...labels, le: bucket.toString() }
      const existing = values.find(v => this.labelsMatch(v.labels, bucketLabels))

      if (existing) {
        if (value <= bucket) {
          existing.value += 1
        }
        existing.timestamp = Date.now()
      } else {
        values.push({
          value: value <= bucket ? 1 : 0,
          timestamp: Date.now(),
          labels: bucketLabels,
        })
      }
    }

    // +Inf bucket
    const infLabels = { ...labels, le: '+Inf' }
    const infExisting = values.find(v => this.labelsMatch(v.labels, infLabels))
    if (infExisting) {
      infExisting.value += 1
      infExisting.timestamp = Date.now()
    } else {
      values.push({ value: 1, timestamp: Date.now(), labels: infLabels })
    }

    this.values.set(key, values)

    // Store sum and count
    this.storeHistogramSumCount(name, labels, value)
  }

  private storeHistogramSumCount(name: string, labels: Record<string, string>, value: number): void {
    // Sum
    const sumKey = `${name}_sum`
    const sumValues = this.values.get(sumKey) || []
    const sumExisting = sumValues.find(v => this.labelsMatch(v.labels, labels))
    if (sumExisting) {
      sumExisting.value += value
      sumExisting.timestamp = Date.now()
    } else {
      sumValues.push({ value, timestamp: Date.now(), labels })
    }
    this.values.set(sumKey, sumValues)

    // Count
    const countKey = `${name}_count`
    const countValues = this.values.get(countKey) || []
    const countExisting = countValues.find(v => this.labelsMatch(v.labels, labels))
    if (countExisting) {
      countExisting.value += 1
      countExisting.timestamp = Date.now()
    } else {
      countValues.push({ value: 1, timestamp: Date.now(), labels })
    }
    this.values.set(countKey, countValues)
  }

  private labelsMatch(a: Record<string, string>, b: Record<string, string>): boolean {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false

    return keysA.every(key => a[key] === b[key])
  }

  // private getLabelKey(name: string, labels: Record<string, string>): string {
  //   const labelStr = Object.entries(labels)
  //     .sort(([a], [b]) => a.localeCompare(b))
  //     .map(([k, v]) => `${k}="${v}"`)
  //     .join(',')
  //   return `${name}{${labelStr}}`
  // }

  export(): string {
    let output = ''

    for (const [name, def] of this.metrics) {
      output += `# HELP ${name} ${def.help}\n`
      output += `# TYPE ${name} ${def.type}\n`

      if (def.type === 'histogram') {
        // Export histogram buckets
        const bucketValues = this.values.get(`${name}_bucket`) || []
        for (const v of bucketValues) {
          output += `${name}_bucket${this.formatLabels(v.labels)} ${v.value}\n`
        }

        // Export sum
        const sumValues = this.values.get(`${name}_sum`) || []
        for (const v of sumValues) {
          output += `${name}_sum${this.formatLabels(v.labels)} ${v.value}\n`
        }

        // Export count
        const countValues = this.values.get(`${name}_count`) || []
        for (const v of countValues) {
          output += `${name}_count${this.formatLabels(v.labels)} ${v.value}\n`
        }
      } else {
        const values = this.values.get(name) || []
        for (const v of values) {
          output += `${name}${this.formatLabels(v.labels)} ${v.value}\n`
        }
      }

      output += '\n'
    }

    return output
  }

  private formatLabels(labels: Record<string, string>): string {
    const entries = Object.entries(labels)
    if (entries.length === 0) return ''

    const labelStr = entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',')

    return `{${labelStr}}`
  }

  getMetric(name: string): MetricValue[] {
    return this.values.get(name) || []
  }

  clear(): void {
    this.values.clear()
  }
}

// Predefined orchestrator metrics
const orchestratorMetrics = new PrometheusMetrics()

// Register default metrics
orchestratorMetrics.register({
  name: 'edgecloud_nodes_total',
  help: 'Total number of registered edge nodes',
  type: 'gauge',
})

orchestratorMetrics.register({
  name: 'edgecloud_nodes_healthy',
  help: 'Number of healthy edge nodes',
  type: 'gauge',
})

orchestratorMetrics.register({
  name: 'edgecloud_tasks_submitted_total',
  help: 'Total number of tasks submitted',
  type: 'counter',
})

orchestratorMetrics.register({
  name: 'edgecloud_tasks_completed_total',
  help: 'Total number of tasks completed',
  type: 'counter',
})

orchestratorMetrics.register({
  name: 'edgecloud_tasks_failed_total',
  help: 'Total number of failed tasks',
  type: 'counter',
})

orchestratorMetrics.register({
  name: 'edgecloud_task_duration_seconds',
  help: 'Task execution duration in seconds',
  type: 'histogram',
})

orchestratorMetrics.register({
  name: 'edgecloud_api_requests_total',
  help: 'Total API requests',
  type: 'counter',
})

orchestratorMetrics.register({
  name: 'edgecloud_api_request_duration_seconds',
  help: 'API request duration in seconds',
  type: 'histogram',
})

orchestratorMetrics.register({
  name: 'edgecloud_active_connections',
  help: 'Number of active WebSocket connections',
  type: 'gauge',
})

export { PrometheusMetrics, orchestratorMetrics }
export type { MetricValue, MetricDefinition }
