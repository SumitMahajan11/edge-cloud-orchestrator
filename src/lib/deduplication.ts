interface RequestKey {
  method: string
  url: string
  body: string
}

interface InFlightRequest<T> {
  key: string
  promise: Promise<T>
  timestamp: number
  subscribers: number
}

interface DeduplicationConfig {
  ttlMs?: number
  maxInFlight?: number
}

class RequestDeduplicator {
  private inFlight: Map<string, InFlightRequest<unknown>> = new Map()
  private completed: Map<string, { result: unknown; timestamp: number }> = new Map()
  private config: Required<DeduplicationConfig>
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: DeduplicationConfig = {}) {
    this.config = {
      ttlMs: 5000, // 5 seconds default
      maxInFlight: 100,
      ...config,
    }
    this.startCleanup()
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 10000) // Cleanup every 10 seconds
  }

  private cleanup(): void {
    const now = Date.now()
    const ttl = this.config.ttlMs

    // Clean completed requests
    for (const [key, entry] of this.completed) {
      if (now - entry.timestamp > ttl) {
        this.completed.delete(key)
      }
    }

    // Clean stale in-flight requests
    for (const [key, request] of this.inFlight) {
      if (now - request.timestamp > ttl * 2) {
        this.inFlight.delete(key)
      }
    }
  }

  private generateKey(method: string, url: string, body?: unknown): string {
    const bodyStr = body ? JSON.stringify(body) : ''
    return `${method}:${url}:${bodyStr}`
  }

  async deduplicate<T>(
    method: string,
    url: string,
    factory: () => Promise<T>,
    body?: unknown
  ): Promise<T> {
    const key = this.generateKey(method, url, body)

    // Check if we have a recent completed result
    const completed = this.completed.get(key)
    if (completed) {
      const age = Date.now() - completed.timestamp
      if (age < this.config.ttlMs) {
        return completed.result as T
      }
      // Expired, remove it
      this.completed.delete(key)
    }

    // Check if there's an in-flight request
    const inFlight = this.inFlight.get(key)
    if (inFlight) {
      inFlight.subscribers++
      return inFlight.promise as Promise<T>
    }

    // Check max in-flight limit
    if (this.inFlight.size >= this.config.maxInFlight) {
      // Remove oldest in-flight request
      const oldest = Array.from(this.inFlight.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0]
      if (oldest) {
        this.inFlight.delete(oldest[0])
      }
    }

    // Create new request
    const promise = this.executeRequest(key, factory)

    const request: InFlightRequest<T> = {
      key,
      promise,
      timestamp: Date.now(),
      subscribers: 1,
    }

    this.inFlight.set(key, request as InFlightRequest<unknown>)

    return promise
  }

  private async executeRequest<T>(key: string, factory: () => Promise<T>): Promise<T> {
    try {
      const result = await factory()

      // Store completed result
      this.completed.set(key, {
        result,
        timestamp: Date.now(),
      })

      // Remove from in-flight
      this.inFlight.delete(key)

      return result
    } catch (error) {
      // Remove from in-flight on error
      this.inFlight.delete(key)
      throw error
    }
  }

  // For mutations - skip deduplication but track
  async track<T>(key: string, factory: () => Promise<T>): Promise<T> {
    // Add timestamp to key to make it unique
    const uniqueKey = `${key}:${Date.now()}`
    return this.deduplicate('TRACK', uniqueKey, factory)
  }

  // Invalidate cached result
  invalidate(method: string, url: string, body?: unknown): boolean {
    const key = this.generateKey(method, url, body)
    const hadCompleted = this.completed.delete(key)
    const hadInFlight = this.inFlight.delete(key)
    return hadCompleted || hadInFlight
  }

  // Invalidate by pattern
  invalidatePattern(pattern: RegExp): number {
    let count = 0

    for (const key of this.completed.keys()) {
      if (pattern.test(key)) {
        this.completed.delete(key)
        count++
      }
    }

    for (const key of this.inFlight.keys()) {
      if (pattern.test(key)) {
        this.inFlight.delete(key)
        count++
      }
    }

    return count
  }

  getStats(): {
    inFlight: number
    completed: number
    totalSubscribers: number
  } {
    let totalSubscribers = 0
    for (const request of this.inFlight.values()) {
      totalSubscribers += request.subscribers
    }

    return {
      inFlight: this.inFlight.size,
      completed: this.completed.size,
      totalSubscribers,
    }
  }

  clear(): void {
    this.inFlight.clear()
    this.completed.clear()
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    this.clear()
  }
}

// HTTP client with deduplication
class DeduplicatingHttpClient {
  private deduplicator: RequestDeduplicator

  constructor(config?: DeduplicationConfig) {
    this.deduplicator = new RequestDeduplicator(config)
  }

  async get<T>(url: string, options?: { deduplicate?: boolean; ttlMs?: number }): Promise<T> {
    const shouldDeduplicate = options?.deduplicate !== false

    if (shouldDeduplicate) {
      return this.deduplicator.deduplicate('GET', url, async () => {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
    } else {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }
  }

  async post<T>(url: string, body: unknown, options?: { deduplicate?: boolean }): Promise<T> {
    const shouldDeduplicate = options?.deduplicate ?? false // Default false for mutations

    const factory = async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }

    if (shouldDeduplicate) {
      return this.deduplicator.deduplicate('POST', url, factory, body)
    } else {
      return factory()
    }
  }

  invalidate(url: string): boolean {
    return this.deduplicator.invalidate('GET', url)
  }

  getStats() {
    return this.deduplicator.getStats()
  }
}

// Singleton instances
export const requestDeduplicator = new RequestDeduplicator()
export const httpClient = new DeduplicatingHttpClient()

export { RequestDeduplicator, DeduplicatingHttpClient }
export type { RequestKey, InFlightRequest, DeduplicationConfig }
