import { Kafka, Consumer, Producer, Message, EachMessagePayload } from 'kafkajs';
import { EventEmitter } from 'eventemitter3';

// ============================================================================
// Types
// ============================================================================

export interface DLQConfig {
  dlqTopicSuffix: string;
  maxRetries: number;
  retryDelayMs: number;
  enabled: boolean;
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
};

// PrismaClient-like interface for dead letter events
interface PrismaClientLike {
  deadLetterEvent: {
    create: (args: any) => Promise<any>;
    findUnique: (args: any) => Promise<any | null>;
    findMany: (args: any) => Promise<any[]>;
    count: (args: any) => Promise<number>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<any>;
    deleteMany: (args: any) => Promise<any>;
    groupBy: (args: any) => Promise<any[]>;
  };
}

// ============================================================================
// Dead Letter Queue Manager
// ============================================================================

export class DeadLetterQueue extends EventEmitter {
  private kafka: Kafka;
  private producer: Producer;
  private prisma: PrismaClientLike;
  private config: DLQConfig;
  private dlqTopics: Set<string> = new Set();

  constructor(
    kafka: Kafka,
    producer: Producer,
    prisma: PrismaClientLike,
    config: Partial<DLQConfig> = {}
  ) {
    super();
    this.kafka = kafka;
    this.producer = producer;
    this.prisma = prisma;
    this.config = { ...DEFAULT_DLQ_CONFIG, ...config };
  }

  /**
   * Get the DLQ topic name for a given original topic
   */
  getDLQTopic(originalTopic: string): string {
    return `${originalTopic}${this.config.dlqTopicSuffix}`;
  }

  /**
   * Create DLQ topics for existing topics
   */
  async ensureDLQTopics(topics: string[]): Promise<void> {
    const admin = this.kafka.admin();
    await admin.connect();

    try {
      const existingTopics = await admin.listTopics();
      const dlqTopics = topics.map((t) => this.getDLQTopic(t));
      const topicsToCreate = dlqTopics.filter((t) => !existingTopics.includes(t));

      if (topicsToCreate.length > 0) {
        await admin.createTopics({
          topics: topicsToCreate.map((topic) => ({
            topic,
            numPartitions: 6,
            replicationFactor: 3,
            configEntries: [
              { name: 'retention.ms', value: '604800000' }, // 7 days
              { name: 'cleanup.policy', value: 'compact' },
            ],
          })),
        });
      }

      for (const topic of dlqTopics) {
        this.dlqTopics.add(topic);
      }
    } finally {
      await admin.disconnect();
    }
  }

  /**
   * Send a failed event to the DLQ
   */
  async sendToDLQ(
    originalTopic: string,
    message: Message,
    error: Error,
    originalEventId?: string
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const dlqTopic = this.getDLQTopic(originalTopic);

    const failedEvent: FailedEvent = {
      id: `dlq-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      originalTopic,
      originalKey: message.key?.toString() || null,
      payload: message.value ? JSON.parse(message.value.toString()) : {},
      headers: this.parseHeaders(message.headers),
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

    // Also send to Kafka DLQ topic for visibility
    await this.producer.send({
      topic: dlqTopic,
      messages: [{
        key: failedEvent.id,
        value: JSON.stringify(failedEvent),
        headers: {
          'original-topic': originalTopic,
          'error': error.message,
          'failed-at': new Date().toISOString(),
        },
      }],
    });

    this.emit('event_added', { eventId: failedEvent.id, originalTopic, error });
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
      payload: e.payload as Record<string, unknown>,
      headers: e.headers as Record<string, string>,
      error: e.error,
      errorStack: e.errorStack || undefined,
      attempts: e.attempts,
      originalEventId: e.originalEventId || undefined,
      timestamp: e.createdAt,
    }));
  }

  /**
   * Retry a failed event
   */
  async retryEvent(eventId: string): Promise<boolean> {
    const event = await this.prisma.deadLetterEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new Error(`Event ${eventId} not found`);
    }

    if (event.status === 'REPROCESSED') {
      throw new Error('Event already reprocessed');
    }

    // Update status
    await this.prisma.deadLetterEvent.update({
      where: { id: eventId },
      data: {
        status: 'RETRYING',
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });

    try {
      // Re-publish to original topic
      await this.producer.send({
        topic: event.originalTopic,
        messages: [{
          key: event.originalKey || undefined,
          value: JSON.stringify(event.payload),
          headers: {
            ...event.headers as Record<string, string>,
            'dlq-retry': 'true',
            'dlq-event-id': eventId,
            'dlq-attempt': String(event.attempts + 1),
          },
        }],
      });

      // Mark as reprocessed
      await this.prisma.deadLetterEvent.update({
        where: { id: eventId },
        data: { status: 'REPROCESSED' },
      });

      this.emit('event_reprocessed', { eventId, originalTopic: event.originalTopic });
      return true;
    } catch (error) {
      // Check if max retries exceeded
      if (event.attempts + 1 >= this.config.maxRetries) {
        await this.prisma.deadLetterEvent.update({
          where: { id: eventId },
          data: { status: 'PERMANENTLY_FAILED' },
        });
        this.emit('event_permanently_failed', { eventId, error });
      } else {
        await this.prisma.deadLetterEvent.update({
          where: { id: eventId },
          data: { status: 'PENDING' },
        });
      }
      throw error;
    }
  }

  /**
   * Retry multiple events
   */
  async retryEvents(eventIds: string[]): Promise<{
    succeeded: string[];
    failed: { id: string; error: string }[];
  }> {
    const succeeded: string[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const eventId of eventIds) {
      try {
        await this.retryEvent(eventId);
        succeeded.push(eventId);
      } catch (error) {
        failed.push({ id: eventId, error: (error as Error).message });
      }
    }

    return { succeeded, failed };
  }

  /**
   * Get DLQ statistics
   */
  async getStats(): Promise<DLQStats> {
    const [totalEvents, pendingRetry, permanentlyFailed, reprocessed, byTopic] = await Promise.all([
      this.prisma.deadLetterEvent.count({}),
      this.prisma.deadLetterEvent.count({ where: { status: 'PENDING' } }),
      this.prisma.deadLetterEvent.count({ where: { status: 'PERMANENTLY_FAILED' } }),
      this.prisma.deadLetterEvent.count({ where: { status: 'REPROCESSED' } }),
      this.prisma.deadLetterEvent.groupBy({
        by: ['originalTopic'],
        _count: { id: true },
        where: { status: 'PENDING' },
      }),
    ]);

    return {
      totalEvents,
      pendingRetry,
      permanentlyFailed,
      reprocessed,
      byTopic: byTopic.reduce((acc: Record<string, number>, item: { originalTopic: string; _count: { id: number } }) => {
        acc[item.originalTopic] = item._count.id;
        return acc;
      }, {} as Record<string, number>),
    };
  }

  /**
   * Purge old events
   */
  async purgeOldEvents(olderThanDays: number = 7): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    
    const result = await this.prisma.deadLetterEvent.deleteMany({
      where: {
        status: { in: ['REPROCESSED', 'PERMANENTLY_FAILED'] },
        createdAt: { lt: cutoff },
      },
    });

    this.emit('purged', { count: result.count });
    return result.count;
  }

  /**
   * Parse Kafka headers
   */
  private parseHeaders(headers?: Record<string, any>): Record<string, string> {
    if (!headers) return {};
    
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (Buffer.isBuffer(value)) {
        result[key] = value.toString();
      } else if (typeof value === 'string') {
        result[key] = value;
      }
    }
    return result;
  }
}
