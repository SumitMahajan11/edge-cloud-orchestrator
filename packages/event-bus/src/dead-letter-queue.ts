import { EventEmitter } from 'eventemitter3';
import Redis from 'ioredis';

// ============================================================================
// Types
// ============================================================================

export interface DLQConfig {
  dlqTopicSuffix: string;
  maxRetries: number;
  retryDelayMs: number;
  enabled: boolean;
  redisStreams: {
    enabled: boolean;
    redisUrl: string;
    retryDelays: number[]; // [1000, 5000, 30000] for exponential backoff
  };
}

export interface FailedEvent {
  id: string;
  originalTopic: string;
  originalKey: string | null;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  error: string;
  errorStack?: string;
  attempts: number;
  originalEventId?: string;
  timestamp: Date;
}

export interface DLQStats {
  totalEvents: number;
  pendingRetry: number;
  permanentlyFailed: number;
  reprocessed: number;
  byTopic: Record<string, number>;
}

export const DEFAULT_DLQ_CONFIG: DLQConfig = {
  dlqTopicSuffix: '.dlq',
  maxRetries: 3,
  retryDelayMs: 5000,
  enabled: true,
  redisStreams: {
    enabled: true,
    redisUrl: 'redis://localhost:6379',
    retryDelays: [1000, 5000, 30000], // 1s, 5s, 30s backoff
  },
};

// ============================================================================
// Prisma Client Type (duck-typed)
// ============================================================================

export interface PrismaClientLike {
  deadLetterEvent: {
    create: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    findUnique: (args: any) => Promise<any | null>;
    count: (args: any) => Promise<number>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<any>;
    deleteMany: (args: any) => Promise<any>;
    groupBy: (args: any) => Promise<any[]>;
  };
}

// ============================================================================
// Dead Letter Queue Manager (Redis Streams only)
// ============================================================================

export class DeadLetterQueue extends EventEmitter {
  private prisma: PrismaClientLike;
  private config: DLQConfig;
  private redisClient: Redis;

  constructor(
    redisOrUrl: string | Redis,
    prisma: PrismaClientLike,
    config: Partial<DLQConfig> = {}
  ) {
    super();
    this.prisma = prisma;
    const redisUrl = typeof redisOrUrl === 'string' ? redisOrUrl : 'redis://managed-client';
    
    this.config = { 
      ...DEFAULT_DLQ_CONFIG, 
      ...config, 
      redisStreams: { 
        enabled: true, 
        redisUrl, 
        retryDelays: config.redisStreams?.retryDelays || [1000, 5000, 30000] 
      } 
    };
    
    // Initialize Redis client
    if (typeof redisOrUrl === 'string') {
      this.redisClient = new Redis(redisOrUrl);
    } else {
      this.redisClient = redisOrUrl;
    }

    this.redisClient.on('error', (err: Error) => {
      console.error('Redis DLQ connection error:', err);
    });
  }

  /**
   * Get Redis DLQ stream name for a given topic
   */
  getRedisDLQStream(streamName: string): string {
    return `${streamName}:dlq`;
  }

  /**
   * Send a failed event to the DLQ (Redis Streams + PostgreSQL)
   */
  async sendToDLQ(
    originalTopic: string,
    message: { key?: string | Buffer; value?: string | Buffer; headers?: Record<string, string> },
    error: Error,
    originalEventId?: string
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const failedEvent: FailedEvent = {
      id: `dlq-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      originalTopic,
      originalKey: message.key?.toString() || null,
      payload: message.value ? JSON.parse(message.value.toString()) : {},
      headers: message.headers || {},
      error: error.message,
      errorStack: error.stack,
      attempts: 1,
      originalEventId,
      timestamp: new Date(),
    };

    // Store in database for reprocessing
    await this.prisma.deadLetterEvent.create({
      data: {
        originalTopic,
        originalKey: failedEvent.originalKey,
        payload: failedEvent.payload,
        headers: failedEvent.headers as any,
        error: failedEvent.error,
        errorStack: failedEvent.errorStack,
        originalEventId,
        status: 'PENDING',
      },
    });

    // Store in Redis Streams for fast inspection
    await this.sendToRedisDLQ(originalTopic, failedEvent, error);

    this.emit('event_added', { eventId: failedEvent.id, originalTopic, error });
  }

  /**
   * Store event in Redis DLQ stream
   */
  private async sendToRedisDLQ(
    originalTopic: string,
    event: FailedEvent,
    error: Error
  ): Promise<void> {
    const dlqStream = this.getRedisDLQStream(originalTopic);
    
    await this.redisClient.xadd(
      dlqStream,
      '*',
      'id', event.id,
      'originalTopic', originalTopic,
      'originalKey', event.originalKey || '',
      'payload', JSON.stringify(event.payload),
      'headers', JSON.stringify(event.headers),
      'error', error.message,
      'errorStack', error.stack || '',
      'attempts', String(event.attempts),
      'originalEventId', event.originalEventId || '',
      'timestamp', event.timestamp.toISOString()
    );
  }

  /**
   * Get failed events from DLQ
   */
  async getFailedEvents(options: {
    topic?: string;
    status?: 'PENDING' | 'RETRYING' | 'REPROCESSED' | 'PERMANENTLY_FAILED';
    limit?: number;
    offset?: number;
  } = {}): Promise<FailedEvent[]> {
    const where: any = {};
    
    if (options.topic) {
      where.originalTopic = options.topic;
    }
    
    if (options.status) {
      where.status = options.status;
    }

    const events = await this.prisma.deadLetterEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options.limit || 50,
      skip: options.offset || 0,
    });

    return events.map((e: { id: string; originalTopic: string; originalKey: string | null; payload: Record<string, unknown>; headers: Record<string, unknown>; error: string; errorStack: string | null; attempts: number; originalEventId: string | null; createdAt: Date }) => ({
      id: e.id,
      originalTopic: e.originalTopic,
      originalKey: e.originalKey,
      payload: e.payload,
      headers: e.headers as Record<string, string>,
      error: e.error,
      errorStack: e.errorStack || undefined,
      attempts: e.attempts,
      originalEventId: e.originalEventId || undefined,
      timestamp: e.createdAt,
    }));
  }

  /**
   * Get DLQ statistics
   */
  async getStats(): Promise<DLQStats> {
    const dbStats = await this.prisma.deadLetterEvent.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    const stats: DLQStats = {
      totalEvents: 0,
      pendingRetry: 0,
      permanentlyFailed: 0,
      reprocessed: 0,
      byTopic: {},
    };

    dbStats.forEach((s: { status: string; _count: { id: number } }) => {
      const count = s._count.id;
      stats.totalEvents += count;
      
      switch (s.status) {
        case 'PENDING':
          stats.pendingRetry += count;
          break;
        case 'PERMANENTLY_FAILED':
          stats.permanentlyFailed += count;
          break;
        case 'REPROCESSED':
          stats.reprocessed += count;
          break;
      }
    });

    // Get Redis DLQ sizes
    try {
      const redisStats = await this.getRedisDLQStats();
      stats.byTopic = redisStats;
    } catch (err) {
      console.error('Failed to get Redis DLQ stats:', err);
    }

    return stats;
  }

  /**
   * Get Redis DLQ stream sizes
   */
  private async getRedisDLQStats(): Promise<Record<string, number>> {
    const keys = await this.redisClient.keys('*:dlq');
    const sizes: Record<string, number> = {};

    for (const key of keys) {
      const len = await this.redisClient.xlen(key);
      sizes[key] = len;
    }

    return sizes;
  }

  /**
   * Retry a failed event
   */
  async retryEvent(eventId: string): Promise<boolean> {
    const event = await this.prisma.deadLetterEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      return false;
    }

    // Update status
    await this.prisma.deadLetterEvent.update({
      where: { id: eventId },
      data: { status: 'RETRYING', attempts: { increment: 1 } },
    });

    // Remove from Redis DLQ
    const dlqStream = this.getRedisDLQStream(event.originalTopic);
    try {
      const entries = await this.redisClient.xrange(dlqStream, '-', '+') as Array<[string, string[]]>;
      for (const [entryId, fields] of entries) {
        // fields is an array: [field1, value1, field2, value2, ...]
        for (let i = 0; i < fields.length; i += 2) {
          if (fields[i] === 'id' && fields[i + 1] === eventId) {
            await this.redisClient.xdel(dlqStream, entryId);
            break;
          }
        }
      }
    } catch (err) {
      console.error('Failed to remove event from Redis DLQ:', err);
    }

    this.emit('event_retried', { eventId, originalTopic: event.originalTopic });
    return true;
  }

  /**
   * Process event with retry logic using Redis Streams
   */
  async processEventWithRetry(
    streamName: string,
    event: any,
    handler: (event: any) => Promise<void>
  ): Promise<boolean> {
    const dlqStream = this.getRedisDLQStream(streamName);
    const retryDelays = this.config.redisStreams.retryDelays;
    let retries = 0;

    while (retries < this.config.maxRetries) {
      try {
        await handler(event);
        return true;
      } catch (err: any) {
        retries++;
        
        if (retries >= this.config.maxRetries) {
          // Max retries exceeded, send to DLQ
          await this.redisClient.xadd(dlqStream, '*',
            'event', JSON.stringify(event),
            'error', err.message,
            'failedAt', new Date().toISOString(),
            'retries', String(retries)
          );
          
          this.emit('event_dlq', { 
            streamName, 
            event, 
            error: err.message,
            retries 
          });
          
          return false;
        }
        
        // Wait before retry with exponential backoff
        const delay = retryDelays[retries - 1] || retryDelays[retryDelays.length - 1];
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    return false;
  }

  /**
   * Purge all DLQ events
   */
  async purge(): Promise<void> {
    // Clear PostgreSQL
    await this.prisma.deadLetterEvent.deleteMany({});

    // Clear Redis DLQ streams
    try {
      const keys = await this.redisClient.keys('*:dlq');
      if (keys.length > 0) {
        await this.redisClient.del(...keys);
      }
    } catch (err) {
      console.error('Failed to purge Redis DLQ:', err);
    }

    this.emit('dlq_purged');
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    await this.redisClient.quit();
  }
}
