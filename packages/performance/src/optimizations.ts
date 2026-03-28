import { EventEmitter } from 'eventemitter3';
import Redis from 'ioredis';
import { Pool, PoolClient } from 'pg';

// Phase 14: Performance Optimization - Caching & Connection Pooling

export interface CacheConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export class DistributedCache extends EventEmitter {
  private redis: Redis;
  private defaultTTL: number = 300; // 5 minutes

  constructor(config: CacheConfig) {
    super();
    this.redis = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db || 0,
      maxRetriesPerRequest: config.maxRetries || 3,
      retryStrategy: (times) => {
        const delay = Math.min(times * (config.retryDelay || 50), 2000);
        return delay;
      },
    });

    this.redis.on('connect', () => this.emit('connected'));
    this.redis.on('error', (err) => this.emit('error', err));
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    return value ? JSON.parse(value) : null;
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    await this.redis.setex(key, ttlSeconds || this.defaultTTL, serialized);
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds?: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async deletePattern(pattern: string): Promise<void> {
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  async increment(key: string, amount: number = 1): Promise<number> {
    return this.redis.incrby(key, amount);
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.redis.expire(key, seconds);
  }

  // Cache-aside pattern with stampede protection
  async getWithLock<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds: number = 300,
    lockTimeout: number = 10
  ): Promise<T> {
    const lockKey = `lock:${key}`;
    const lockValue = `${Date.now()}-${Math.random()}`;

    // Try to get from cache
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Try to acquire lock
    const acquired = await this.redis.set(lockKey, lockValue, 'EX', lockTimeout, 'NX');
    
    if (acquired) {
      try {
        // We have the lock, fetch and cache
        const value = await factory();
        await this.set(key, value, ttlSeconds);
        return value;
      } finally {
        // Release lock
        await this.redis.del(lockKey);
      }
    } else {
      // Someone else is fetching, wait and retry
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.getWithLock(key, factory, ttlSeconds, lockTimeout);
    }
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

// Multi-layer caching: L1 (in-memory) + L2 (Redis)
export class MultiLayerCache extends EventEmitter {
  private l1Cache: Map<string, { value: any; expires: number }> = new Map();
  private l2Cache: DistributedCache;
  private l1TTL: number = 60000; // 1 minute in-memory

  constructor(redisConfig: CacheConfig) {
    super();
    this.l2Cache = new DistributedCache(redisConfig);
    
    // Periodic cleanup of expired L1 entries
    setInterval(() => this.cleanupL1(), 60000);
  }

  async get<T>(key: string): Promise<T | null> {
    // Check L1 first
    const l1Entry = this.l1Cache.get(key);
    if (l1Entry && l1Entry.expires > Date.now()) {
      return l1Entry.value;
    }

    // Check L2
    const l2Value = await this.l2Cache.get<T>(key);
    if (l2Value !== null) {
      // Populate L1
      this.l1Cache.set(key, { value: l2Value, expires: Date.now() + this.l1TTL });
      return l2Value;
    }

    return null;
  }

  async set(key: string, value: any, l2TTL: number = 300): Promise<void> {
    // Set in both layers
    this.l1Cache.set(key, { value, expires: Date.now() + this.l1TTL });
    await this.l2Cache.set(key, value, l2TTL);
  }

  async delete(key: string): Promise<void> {
    this.l1Cache.delete(key);
    await this.l2Cache.delete(key);
  }

  private cleanupL1(): void {
    const now = Date.now();
    for (const [key, entry] of this.l1Cache.entries()) {
      if (entry.expires <= now) {
        this.l1Cache.delete(key);
      }
    }
  }

  async close(): Promise<void> {
    await this.l2Cache.close();
  }
}

// Optimized database connection pooling
export interface PooledDatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: any;
  poolSize?: number;
  statementTimeout?: number;
  queryTimeout?: number;
}

export class PooledDatabase extends EventEmitter {
  private pool: Pool;
  private queryMetrics: Map<string, { count: number; totalTime: number }> = new Map();

  constructor(config: PooledDatabaseConfig) {
    super();
    
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl,
      max: config.poolSize || 20,
      min: 5,
      acquireTimeoutMillis: 5000,
      createTimeoutMillis: 5000,
      destroyTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 200,
      statement_timeout: (config.statementTimeout || 30) * 1000,
      query_timeout: (config.queryTimeout || 30) * 1000,
    });

    this.pool.on('connect', () => this.emit('connect'));
    this.pool.on('error', (err) => this.emit('error', err));
    this.pool.on('acquire', () => this.emit('acquire'));
    this.pool.on('remove', () => this.emit('remove'));
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const startTime = Date.now();
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(sql, params);
      
      // Track metrics
      const duration = Date.now() - startTime;
      this.trackQuery(sql, duration);
      
      return result.rows;
    } finally {
      client.release();
    }
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private trackQuery(sql: string, duration: number): void {
    // Extract operation type (simplified)
    const operation = sql.trim().split(' ')[0].toUpperCase();
    
    const metrics = this.queryMetrics.get(operation) || { count: 0, totalTime: 0 };
    metrics.count++;
    metrics.totalTime += duration;
    this.queryMetrics.set(operation, metrics);
  }

  getMetrics() {
    const metrics: Record<string, { count: number; avgTime: number }> = {};
    for (const [op, data] of this.queryMetrics) {
      metrics[op] = {
        count: data.count,
        avgTime: data.totalTime / data.count,
      };
    }
    return {
      totalConnections: this.pool.totalCount,
      idleConnections: this.pool.idleCount,
      waitingClients: this.pool.waitingCount,
      queryMetrics: metrics,
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Query result caching wrapper
export class CachedQueryExecutor extends EventEmitter {
  private db: PooledDatabase;
  private cache: MultiLayerCache;

  constructor(db: PooledDatabase, cache: MultiLayerCache) {
    super();
    this.db = db;
    this.cache = cache;
  }

  async query<T>(
    sql: string,
    params?: any[],
    options?: {
      cacheKey?: string;
      cacheTTL?: number;
      skipCache?: boolean;
    }
  ): Promise<T[]> {
    const cacheKey = options?.cacheKey || `query:${this.hashQuery(sql, params)}`;

    if (!options?.skipCache) {
      const cached = await this.cache.get<T[]>(cacheKey);
      if (cached !== null) {
        this.emit('cacheHit', { cacheKey, sql });
        return cached;
      }
    }

    const result = await this.db.query<T>(sql, params);

    if (!options?.skipCache) {
      await this.cache.set(cacheKey, result, options?.cacheTTL);
      this.emit('cacheMiss', { cacheKey, sql });
    }

    return result;
  }

  async invalidateQuery(pattern: string): Promise<void> {
    await this.cache.deletePattern(`query:*${pattern}*`);
  }

  private hashQuery(sql: string, params?: any[]): string {
    // Simple hash for demo - use proper hashing in production
    const str = `${sql}:${JSON.stringify(params)}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}

// Rate limiter with Redis backend
export class DistributedRateLimiter extends EventEmitter {
  private redis: Redis;

  constructor(redisConfig: CacheConfig) {
    super();
    this.redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
    });
  }

  async isAllowed(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const windowKey = `ratelimit:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
    
    const current = await this.redis.incr(windowKey);
    if (current === 1) {
      await this.redis.expire(windowKey, windowSeconds);
    }
    
    return current <= limit;
  }

  async getRemaining(key: string, limit: number, windowSeconds: number): Promise<number> {
    const windowKey = `ratelimit:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
    const current = await this.redis.get(windowKey);
    return limit - (parseInt(current || '0', 10));
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
