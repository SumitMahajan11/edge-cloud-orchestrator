import axios from 'axios'
import type { AxiosInstance, AxiosResponse, AxiosError } from 'axios'

interface AgentConnection {
  client: AxiosInstance
  lastUsed: number
  failureCount: number
  isHealthy: boolean
}

interface PoolConfig {
  maxConnections?: number
  connectionTimeout?: number
  keepAliveDuration?: number
  maxFailures?: number
}

const DEFAULT_CONFIG: PoolConfig = {
  maxConnections: 10,
  connectionTimeout: 5000,
  keepAliveDuration: 30000,
  maxFailures: 3
}

class AgentConnectionPool {
  private pools: Map<string, AgentConnection> = new Map()
  private config: PoolConfig

  constructor(config: PoolConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.startCleanupInterval()
  }

  private getClient(agentUrl: string): AxiosInstance {
    let connection = this.pools.get(agentUrl)

    if (!connection || !connection.isHealthy) {
      connection = this.createConnection(agentUrl)
      this.pools.set(agentUrl, connection)
    }

    connection.lastUsed = Date.now()
    return connection.client
  }

  private createConnection(agentUrl: string): AgentConnection {
    const client = axios.create({
      baseURL: agentUrl,
      timeout: this.config.connectionTimeout,
      headers: {
        'Connection': 'keep-alive',
        'Keep-Alive': `timeout=${this.config.keepAliveDuration! / 1000}`
      }
    })

    // Add response interceptor for health tracking
    client.interceptors.response.use(
      (response: AxiosResponse) => {
        this.recordSuccess(agentUrl)
        return response
      },
      (error: AxiosError) => {
        this.recordFailure(agentUrl)
        return Promise.reject(error)
      }
    )

    return {
      client,
      lastUsed: Date.now(),
      failureCount: 0,
      isHealthy: true
    }
  }

  private recordSuccess(agentUrl: string) {
    const connection = this.pools.get(agentUrl)
    if (connection) {
      connection.failureCount = 0
      connection.isHealthy = true
    }
  }

  private recordFailure(agentUrl: string) {
    const connection = this.pools.get(agentUrl)
    if (connection) {
      connection.failureCount++
      if (connection.failureCount >= this.config.maxFailures!) {
        connection.isHealthy = false
      }
    }
  }

  async executeWithRetry<T>(
    agentUrl: string,
    operation: (client: AxiosInstance) => Promise<T>,
    retries = 3
  ): Promise<T> {
    const delays = [1000, 2000, 4000] // Exponential backoff

    for (let i = 0; i <= retries; i++) {
      try {
        const client = this.getClient(agentUrl)
        return await operation(client)
      } catch (error) {
        if (i === retries) throw error
        
        await this.delay(delays[i] || 4000)
        
        // Mark connection as unhealthy after failure
        const connection = this.pools.get(agentUrl)
        if (connection) {
          connection.isHealthy = false
        }
      }
    }

    throw new Error(`Failed after ${retries} retries`)
  }

  async getHealth(agentUrl: string): Promise<{ healthy: boolean; latency: number }> {
    const start = Date.now()
    try {
      const client = this.getClient(agentUrl)
      await client.get('/health', { timeout: 2000 })
      return { healthy: true, latency: Date.now() - start }
    } catch {
      return { healthy: false, latency: Date.now() - start }
    }
  }

  async executeTask(agentUrl: string, taskData: unknown): Promise<unknown> {
    return this.executeWithRetry(agentUrl, async (client) => {
      const response = await client.post('/run-task', taskData)
      return response.data
    })
  }

  async getMetrics(agentUrl: string): Promise<unknown> {
    return this.executeWithRetry(agentUrl, async (client) => {
      const response = await client.get('/metrics')
      return response.data
    }, 1) // Only 1 retry for metrics
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private startCleanupInterval() {
    setInterval(() => {
      const now = Date.now()
      const staleThreshold = this.config.keepAliveDuration! * 2

      for (const [url, connection] of this.pools.entries()) {
        // Remove stale connections
        if (now - connection.lastUsed > staleThreshold) {
          this.pools.delete(url)
        }
      }
    }, 60000) // Cleanup every minute
  }

  getPoolStats(): { total: number; healthy: number; unhealthy: number } {
    let healthy = 0
    let unhealthy = 0

    for (const connection of this.pools.values()) {
      if (connection.isHealthy) healthy++
      else unhealthy++
    }

    return {
      total: this.pools.size,
      healthy,
      unhealthy
    }
  }

  resetPool(agentUrl?: string) {
    if (agentUrl) {
      this.pools.delete(agentUrl)
    } else {
      this.pools.clear()
    }
  }
}

// Singleton instance
export const agentPool = new AgentConnectionPool()

export default AgentConnectionPool
