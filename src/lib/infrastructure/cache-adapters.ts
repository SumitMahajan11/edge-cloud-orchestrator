interface CacheAdapter {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>
  delete(key: string): Promise<boolean>
  exists(key: string): Promise<boolean>
  clear(): Promise<void>
  keys(pattern?: string): Promise<string[]>
}

interface RedisConfig {
  host: string
  port: number
  password?: string
  db?: number
  keyPrefix?: string
}

// Redis Adapter
class RedisAdapter implements CacheAdapter {
  private config: RedisConfig
  // private _client?: unknown  // Reserved for future Redis client implementation
  private connected = false

  constructor(config: RedisConfig) {
    this.config = {
      ...config,
      host: config.host ?? 'localhost',
      port: config.port ?? 6379,
      db: config.db ?? 0,
      keyPrefix: config.keyPrefix ?? 'edgecloud:',
    }
  }

  async connect(): Promise<void> {
    console.log(`Connecting to Redis at ${this.config.host}:${this.config.port}`)
    // In production: import 'ioredis' and create real client
    this.connected = true
  }

  async disconnect(): Promise<void> {
    console.log('Disconnecting from Redis')
    this.connected = false
  }

  private getKey(key: string): string {
    return `${this.config.keyPrefix}${key}`
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.connected) throw new Error('Not connected')
    const fullKey = this.getKey(key)
    console.log(`Redis GET: ${fullKey}`)
    // Mock: return null
    return null
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    if (!this.connected) throw new Error('Not connected')
    const fullKey = this.getKey(key)
    JSON.stringify(value) // Validate serializable
    console.log(`Redis SET: ${fullKey} (TTL: ${ttlMs}ms)`)
  }

  async delete(key: string): Promise<boolean> {
    if (!this.connected) throw new Error('Not connected')
    const fullKey = this.getKey(key)
    console.log(`Redis DEL: ${fullKey}`)
    return true
  }

  async exists(key: string): Promise<boolean> {
    if (!this.connected) throw new Error('Not connected')
    const fullKey = this.getKey(key)
    console.log(`Redis EXISTS: ${fullKey}`)
    return false
  }

  async clear(): Promise<void> {
    if (!this.connected) throw new Error('Not connected')
    console.log('Redis FLUSHDB')
  }

  async keys(pattern = '*'): Promise<string[]> {
    if (!this.connected) throw new Error('Not connected')
    const fullPattern = this.getKey(pattern)
    console.log(`Redis KEYS: ${fullPattern}`)
    return []
  }

  // Redis-specific operations
  async increment(key: string, amount = 1): Promise<number> {
    if (!this.connected) throw new Error('Not connected')
    console.log(`Redis INCRBY: ${this.getKey(key)} ${amount}`)
    return amount
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    if (!this.connected) throw new Error('Not connected')
    console.log(`Redis EXPIRE: ${this.getKey(key)} ${seconds}`)
    return true
  }

  async ttl(key: string): Promise<number> {
    if (!this.connected) throw new Error('Not connected')
    console.log(`Redis TTL: ${this.getKey(key)}`)
    return -1
  }
}

// In-Memory Cache Adapter (fallback)
class MemoryCacheAdapter implements CacheAdapter {
  private cache: Map<string, { value: unknown; expiry: number | null }> = new Map()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => {
      const now = Date.now()
      for (const [key, entry] of this.cache) {
        if (entry.expiry && entry.expiry <= now) {
          this.cache.delete(key)
        }
      }
    }, 60000)
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key)
    if (!entry) return null

    if (entry.expiry && entry.expiry <= Date.now()) {
      this.cache.delete(key)
      return null
    }

    return entry.value as T
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const expiry = ttlMs ? Date.now() + ttlMs : null
    this.cache.set(key, { value, expiry })
  }

  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key)
  }

  async exists(key: string): Promise<boolean> {
    const entry = this.cache.get(key)
    if (!entry) return false
    if (entry.expiry && entry.expiry <= Date.now()) {
      this.cache.delete(key)
      return false
    }
    return true
  }

  async clear(): Promise<void> {
    this.cache.clear()
  }

  async keys(pattern = '*'): Promise<string[]> {
    const regex = new RegExp(pattern.replace('*', '.*'))
    return Array.from(this.cache.keys()).filter(key => regex.test(key))
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    this.cache.clear()
  }

  getStats(): {
    size: number
    expired: number
    valid: number
  } {
    const now = Date.now()
    let expired = 0
    let valid = 0

    for (const entry of this.cache.values()) {
      if (entry.expiry && entry.expiry <= now) {
        expired++
      } else {
        valid++
      }
    }

    return {
      size: this.cache.size,
      expired,
      valid,
    }
  }
}

// Cache Manager with multi-layer caching
class CacheManager {
  private l1: MemoryCacheAdapter // L1: In-memory (fast)
  private l2: CacheAdapter | null = null // L2: Redis (distributed)
  private l2Enabled = false

  constructor() {
    this.l1 = new MemoryCacheAdapter()
  }

  async initializeL2(config: RedisConfig): Promise<void> {
    const redis = new RedisAdapter(config)
    await redis.connect()
    this.l2 = redis
    this.l2Enabled = true
  }

  async get<T>(key: string): Promise<T | null> {
    // Try L1 first
    let value = await this.l1.get<T>(key)
    if (value !== null) return value

    // Try L2 if enabled
    if (this.l2Enabled && this.l2) {
      value = await this.l2.get<T>(key)
      if (value !== null) {
        // Backfill L1
        await this.l1.set(key, value, 60000) // 1 min in L1
        return value
      }
    }

    return null
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    // Always write to L1
    await this.l1.set(key, value, ttlMs)

    // Write to L2 if enabled
    if (this.l2Enabled && this.l2) {
      await this.l2.set(key, value, ttlMs)
    }
  }

  async delete(key: string): Promise<boolean> {
    const l1Deleted = await this.l1.delete(key)
    let l2Deleted = false

    if (this.l2Enabled && this.l2) {
      l2Deleted = await this.l2.delete(key)
    }

    return l1Deleted || l2Deleted
  }

  async clear(): Promise<void> {
    await this.l1.clear()
    if (this.l2Enabled && this.l2) {
      await this.l2.clear()
    }
  }

  // Cache-aside pattern helper
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlMs?: number
  ): Promise<T> {
    let value = await this.get<T>(key)
    if (value !== null) return value

    value = await factory()
    await this.set(key, value, ttlMs)
    return value
  }

  // Cache warming
  async warmCache<T>(keys: string[], factory: (key: string) => Promise<T>, ttlMs?: number): Promise<void> {
    await Promise.all(
      keys.map(async (key) => {
        const value = await factory(key)
        await this.set(key, value, ttlMs)
      })
    )
  }

  // Invalidate by pattern
  async invalidatePattern(pattern: string): Promise<void> {
    const keys = await this.l1.keys(pattern)
    await Promise.all(keys.map(key => this.l1.delete(key)))

    if (this.l2Enabled && this.l2) {
      const l2Keys = await this.l2.keys(pattern)
      await Promise.all(l2Keys.map(key => this.l2!.delete(key)))
    }
  }

  getStats(): {
    l1: ReturnType<MemoryCacheAdapter['getStats']>
    l2Enabled: boolean
  } {
    return {
      l1: this.l1.getStats(),
      l2Enabled: this.l2Enabled,
    }
  }

  destroy(): void {
    this.l1.destroy()
    if (this.l2) {
      this.l2.clear()
    }
  }
}

// Singleton instance
export const cacheManager = new CacheManager()

export { RedisAdapter, MemoryCacheAdapter, CacheManager }
export type { CacheAdapter, RedisConfig }
