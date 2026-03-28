interface RateLimitConfig {
  windowMs: number
  maxRequests: number
  keyPrefix?: string
}

interface RateLimitEntry {
  count: number
  resetTime: number
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetTime: number
  retryAfter?: number
}

const DEFAULT_CONFIGS: Record<string, RateLimitConfig> = {
  // Strict limits for auth endpoints
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
    keyPrefix: 'auth',
  },
  // General API limits
  api: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
    keyPrefix: 'api',
  },
  // Task submission limits
  tasks: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30,
    keyPrefix: 'tasks',
  },
  // Node management limits
  nodes: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 20,
    keyPrefix: 'nodes',
  },
  // Webhook limits
  webhooks: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 50,
    keyPrefix: 'webhooks',
  },
}

class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map()
  private configs: Map<string, RateLimitConfig> = new Map()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    // Initialize default configs
    Object.entries(DEFAULT_CONFIGS).forEach(([key, config]) => {
      this.configs.set(key, config)
    })

    // Start cleanup interval
    this.startCleanup()
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now()
      for (const [key, entry] of this.store) {
        if (entry.resetTime <= now) {
          this.store.delete(key)
        }
      }
    }, 60000) // Cleanup every minute
  }

  check(key: string, configKey: string = 'api'): RateLimitResult {
    const config = this.configs.get(configKey)
    if (!config) {
      throw new Error(`Unknown rate limit config: ${configKey}`)
    }

    const fullKey = `${config.keyPrefix}:${key}`
    const now = Date.now()
    let entry = this.store.get(fullKey)

    // Create new entry if doesn't exist or expired
    if (!entry || entry.resetTime <= now) {
      entry = {
        count: 0,
        resetTime: now + config.windowMs,
      }
      this.store.set(fullKey, entry)
    }

    // Check if limit exceeded
    if (entry.count >= config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: entry.resetTime,
        retryAfter: Math.ceil((entry.resetTime - now) / 1000),
      }
    }

    // Increment count
    entry.count++

    return {
      allowed: true,
      remaining: config.maxRequests - entry.count,
      resetTime: entry.resetTime,
    }
  }

  async checkAsync(key: string, configKey: string = 'api'): Promise<RateLimitResult> {
    return this.check(key, configKey)
  }

  // Middleware helper
  middleware(configKey: string = 'api') {
    return (identifier: string) => {
      const result = this.check(identifier, configKey)
      if (!result.allowed) {
        throw new RateLimitExceededError(
          `Rate limit exceeded. Retry after ${result.retryAfter} seconds`,
          result.retryAfter || 60
        )
      }
      return result
    }
  }

  setConfig(key: string, config: RateLimitConfig): void {
    this.configs.set(key, config)
  }

  getConfig(key: string): RateLimitConfig | undefined {
    return this.configs.get(key)
  }

  reset(key?: string): void {
    if (key) {
      // Reset specific key patterns
      for (const [storeKey] of this.store) {
        if (storeKey.includes(key)) {
          this.store.delete(storeKey)
        }
      }
    } else {
      this.store.clear()
    }
  }

  getStats(): {
    totalKeys: number
    configs: string[]
    entriesByConfig: Record<string, number>
  } {
    const entriesByConfig: Record<string, number> = {}

    for (const key of this.store.keys()) {
      const configKey = key.split(':')[0]
      entriesByConfig[configKey] = (entriesByConfig[configKey] || 0) + 1
    }

    return {
      totalKeys: this.store.size,
      configs: Array.from(this.configs.keys()),
      entriesByConfig,
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    this.store.clear()
  }
}

class RateLimitExceededError extends Error {
  retryAfter: number

  constructor(message: string, retryAfter: number) {
    super(message)
    this.name = 'RateLimitExceededError'
    this.retryAfter = retryAfter
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter()

export { RateLimiter, RateLimitExceededError, DEFAULT_CONFIGS }
export type { RateLimitConfig, RateLimitEntry, RateLimitResult }
