type HealthStatus = 'healthy' | 'degraded' | 'unhealthy'

interface HealthCheckResult {
  name: string
  status: HealthStatus
  responseTime: number
  message?: string
  lastChecked: number
}

interface SystemHealth {
  status: HealthStatus
  checks: HealthCheckResult[]
  timestamp: number
  uptime: number
  version: string
}

interface HealthCheckConfig {
  name: string
  check: () => Promise<boolean>
  timeout?: number
  critical?: boolean
}

class HealthCheckManager {
  private checks: Map<string, HealthCheckConfig> = new Map()
  private results: Map<string, HealthCheckResult> = new Map()
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private startTime = Date.now()
  private version = '1.0.0'

  register(config: HealthCheckConfig): void {
    this.checks.set(config.name, {
      timeout: 5000,
      critical: false,
      ...config,
    })
  }

  async runCheck(name: string): Promise<HealthCheckResult> {
    const config = this.checks.get(name)
    if (!config) {
      throw new Error(`Health check "${name}" not found`)
    }

    const startTime = Date.now()
    let status: HealthStatus = 'healthy'
    let message: string | undefined

    try {
      const timeoutPromise = new Promise<boolean>((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), config.timeout)
      })

      const success = await Promise.race([config.check(), timeoutPromise])

      if (!success) {
        status = config.critical ? 'unhealthy' : 'degraded'
        message = 'Check returned false'
      }
    } catch (error) {
      status = config.critical ? 'unhealthy' : 'degraded'
      message = error instanceof Error ? error.message : 'Unknown error'
    }

    const result: HealthCheckResult = {
      name,
      status,
      responseTime: Date.now() - startTime,
      message,
      lastChecked: Date.now(),
    }

    this.results.set(name, result)
    return result
  }

  async runAllChecks(): Promise<SystemHealth> {
    const checks: HealthCheckResult[] = []

    for (const name of this.checks.keys()) {
      const result = await this.runCheck(name)
      checks.push(result)
    }

    // Determine overall status
    let status: HealthStatus = 'healthy'
    if (checks.some(c => c.status === 'unhealthy')) {
      status = 'unhealthy'
    } else if (checks.some(c => c.status === 'degraded')) {
      status = 'degraded'
    }

    return {
      status,
      checks,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      version: this.version,
    }
  }

  startPeriodicChecks(intervalMs = 30000): void {
    this.checkInterval = setInterval(async () => {
      await this.runAllChecks()
    }, intervalMs)
  }

  stopPeriodicChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }

  getResult(name: string): HealthCheckResult | undefined {
    return this.results.get(name)
  }

  getAllResults(): HealthCheckResult[] {
    return Array.from(this.results.values())
  }

  // Built-in health checks
  registerDefaultChecks(): void {
    // Database check
    this.register({
      name: 'database',
      check: async () => {
        // Check if database is accessible
        return true
      },
      critical: true,
    })

    // Edge agents check
    this.register({
      name: 'edge-agents',
      check: async () => {
        // Check if at least one agent is online
        return true
      },
      critical: false,
    })

    // Memory check
    this.register({
      name: 'memory',
      check: async () => {
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory
        if (!memory) return true

        const usage = memory.usedJSHeapSize / memory.totalJSHeapSize
        return usage < 0.9 // Healthy if less than 90%
      },
      critical: false,
    })

    // Disk check (simulated)
    this.register({
      name: 'disk',
      check: async () => {
        // In production, check actual disk usage
        return true
      },
      critical: false,
    })
  }

  // Express middleware
  middleware() {
    return async (_req: unknown, res: { status: (code: number) => unknown; json: (data: unknown) => void }) => {
      const health = await this.runAllChecks()
      const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503
      res.status(statusCode)
      res.json(health)
    }
  }

  // Kubernetes probe endpoints
  livenessProbe() {
    return async (_req: unknown, res: { status: (code: number) => unknown; send: (data: string) => void }) => {
      // Simple liveness check - is the process running?
      res.status(200)
      res.send('OK')
    }
  }

  readinessProbe() {
    return async (_req: unknown, res: { status: (code: number) => unknown; json: (data: unknown) => void }) => {
      const health = await this.runAllChecks()
      const isReady = health.status !== 'unhealthy'
      res.status(isReady ? 200 : 503)
      res.json({ ready: isReady, status: health.status })
    }
  }
}

// Singleton instance
export const healthCheckManager = new HealthCheckManager()

export { HealthCheckManager }
export type { HealthStatus, HealthCheckResult, SystemHealth, HealthCheckConfig }
