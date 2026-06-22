/**
 * Idempotency Service
 *
 * Ensures exactly-once processing across the distributed system.
 * Handles deduplication for:
 * - Kafka message processing
 * - API requests
 * - Saga steps
 * - Task execution
 */

import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import type { Logger } from 'pino';

// ============================================================================
// Types
// ============================================================================

export interface IdempotencyConfig {
  defaultTtlMs: number;
  cacheEnabled: boolean;
  cacheTtlMs: number;
}

export interface IdempotentRequest {
  idempotencyKey: string;
  resourceType: string;
  resourceId: string;
  requestHash?: string;
  ttlMs?: number;
}

export interface IdempotencyResult {
  isDuplicate: boolean;
  existingResult?: Record<string, unknown>;
  recordId?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: IdempotencyConfig = {
  defaultTtlMs: 86400000, // 24 hours
  cacheEnabled: true,
  cacheTtlMs: 3600000, // 1 hour cache
};

const CACHE_KEY_PREFIX = 'idempotency:';
const LOCK_KEY_PREFIX = 'idempotency:lock:';

// ============================================================================
// IdempotencyService
// ============================================================================

export class IdempotencyService {
  private prisma: PrismaClient;
  private redis: Redis;
  private logger: Logger;
  private config: IdempotencyConfig;

  constructor(
    prisma: PrismaClient,
    redis: Redis,
    logger: Logger,
    config: Partial<IdempotencyConfig> = {},
  ) {
    this.prisma = prisma;
    this.redis = redis;
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check and record idempotency atomically
   * Returns true if this is a duplicate that should be skipped
   */
  async checkAndRecord(request: IdempotentRequest): Promise<IdempotencyResult> {
    const { idempotencyKey, resourceType, resourceId, requestHash, ttlMs } =
      request;
    const cacheKey = `${CACHE_KEY_PREFIX}${idempotencyKey}`;
    const lockKey = `${LOCK_KEY_PREFIX}${idempotencyKey}`;
    const ttl = ttlMs || this.config.defaultTtlMs;

    // 1. Check Redis cache first (fast path)
    if (this.config.cacheEnabled) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        const result = JSON.parse(cached);
        this.logger.debug({ idempotencyKey }, 'Idempotency cache hit');
        return {
          isDuplicate: true,
          existingResult: result,
        };
      }
    }

    // 2. Acquire distributed lock to prevent race conditions
    const lockAcquired = await this.acquireLock(lockKey, 5000);
    if (!lockAcquired) {
      // Another process is handling this - wait and check
      await this.waitForLockRelease(lockKey);

      // Check again for existing record
      const existing = await this.findExisting(idempotencyKey);
      if (existing) {
        return { isDuplicate: true, existingResult: existing };
      }
    }

    try {
      // 3. Check database for existing record
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: { idempotencyKey },
      });

      if (existing) {
        const parsedResult = this.parseResult(existing.result);
        // Update cache
        if (this.config.cacheEnabled && parsedResult) {
          await this.redis.setex(
            cacheKey,
            Math.floor(this.config.cacheTtlMs / 1000),
            JSON.stringify(parsedResult),
          );
        }

        return {
          isDuplicate: true,
          existingResult: parsedResult as Record<string, unknown>,
        };
      }

      // 4. Create new record (PROCESSING status)
      const record = await this.prisma.idempotencyRecord.create({
        data: {
          idempotencyKey,
          resourceType,
          resourceId,
          requestHash: requestHash ?? null,
          status: 'PROCESSING',
          expiresAt: new Date(Date.now() + ttl),
        },
      });

      this.logger.debug(
        { idempotencyKey, recordId: record.id },
        'Created idempotency record',
      );

      return {
        isDuplicate: false,
        recordId: record.id,
      };
    } finally {
      // Release lock
      await this.releaseLock(lockKey);
    }
  }

  /**
   * Mark idempotency record as completed with result
   */
  async complete(
    idempotencyKey: string,
    result: Record<string, unknown>,
  ): Promise<void> {
    const cacheKey = `${CACHE_KEY_PREFIX}${idempotencyKey}`;

    // Update database
    await this.prisma.idempotencyRecord.update({
      where: { idempotencyKey },
      data: {
        status: 'COMPLETED',
        result: this.isSqlite() ? JSON.stringify(result) : (result as any),
      },
    });

    // Update cache
    if (this.config.cacheEnabled) {
      await this.redis.setex(
        cacheKey,
        Math.floor(this.config.cacheTtlMs / 1000),
        JSON.stringify(result),
      );
    }

    this.logger.debug({ idempotencyKey }, 'Marked idempotency as completed');
  }

  /**
   * Mark idempotency record as failed
   */
  async fail(idempotencyKey: string, error?: string): Promise<void> {
    const resultObj = error ? { error } : {};
    await this.prisma.idempotencyRecord.update({
      where: { idempotencyKey },
      data: {
        status: 'FAILED',
        result: this.isSqlite() ? JSON.stringify(resultObj) : (resultObj as any),
      },
    });

    this.logger.debug({ idempotencyKey }, 'Marked idempotency as failed');
  }

  /**
   * Generate idempotency key from components
   */
  static generateKey(
    prefix: string,
    ...components: (string | number)[]
  ): string {
    const combined = components.join(':');
    const hash = createHash('sha256')
      .update(combined)
      .digest('hex')
      .substring(0, 16);
    return `${prefix}:${hash}`;
  }

  /**
   * Generate key for Kafka message
   */
  static forKafkaMessage(
    topic: string,
    partition: number,
    offset: string,
  ): string {
    return this.generateKey('kafka', topic, partition, offset);
  }

  /**
   * Generate key for API request
   */
  static forApiRequest(
    userId: string,
    endpoint: string,
    requestHash: string,
  ): string {
    return this.generateKey('api', userId, endpoint, requestHash);
  }

  /**
   * Generate key for Saga step
   */
  static forSagaStep(
    sagaId: string,
    stepName: string,
    attempt: number,
  ): string {
    return this.generateKey('saga', sagaId, stepName, attempt);
  }

  /**
   * Generate key for Task execution
   */
  static forTaskExecution(taskId: string, nodeId: string): string {
    return this.generateKey('task', taskId, nodeId);
  }

  private isSqlite(): boolean {
    const activeProvider = (this.prisma as any)._activeProvider || (this.prisma as any)._engineConfig?.activeProvider;
    if (activeProvider === 'sqlite') {
      return true;
    }
    const url = (this.prisma as any).$config?.datasources?.db?.url;
    if (typeof url === 'string' && (url.startsWith('file:') || url.includes('sqlite'))) {
      return true;
    }
    return false;
  }

  private parseResult(val: any): Record<string, unknown> | null {
    if (!val) return null;
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch (err) {
        return null;
      }
    }
    return val as Record<string, unknown>;
  }

  // Private methods

  private async acquireLock(key: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(key, '1', 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  private async releaseLock(key: string): Promise<void> {
    await this.redis.del(key);
  }

  private async waitForLockRelease(
    key: string,
    maxWaitMs: number = 5000,
  ): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const exists = await this.redis.exists(key);
      if (!exists) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private async findExisting(
    idempotencyKey: string,
  ): Promise<Record<string, unknown> | null> {
    const record = await this.prisma.idempotencyRecord.findUnique({
      where: { idempotencyKey },
    });
    return record ? this.parseResult(record.result) : null;
  }

  /**
   * Cleanup expired records (run periodically)
   */
  async cleanupExpired(): Promise<number> {
    const result = await this.prisma.idempotencyRecord.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    this.logger.info(
      { count: result.count },
      'Cleaned up expired idempotency records',
    );
    return result.count;
  }
}
