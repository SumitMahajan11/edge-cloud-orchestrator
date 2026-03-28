import { EventEmitter } from 'eventemitter3';
import { Producer, Message } from 'kafkajs';

// Define types locally to avoid direct Prisma dependency
export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED';

export interface OutboxConfig {
  pollingIntervalMs: number;
  batchSize: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  enabled: boolean;
}

export interface OutboxEventInput {
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface OutboxEvent {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  headers?: Record<string, string> | null;
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// PrismaClient type with outboxEvent methods
interface PrismaClientLike {
  outboxEvent: {
    create: (args: any) => Promise<any>;
    createMany: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    findFirst: (args: any) => Promise<any | null>;
    count: (args: any) => Promise<number>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<any>;
  };
}

export const DEFAULT_OUTBOX_CONFIG: OutboxConfig = {
  pollingIntervalMs: 1000,
  batchSize: 100,
  maxAttempts: 5,
  retryBaseDelayMs: 1000,
  retryMaxDelayMs: 60000,
  enabled: true,
};

export class OutboxManager extends EventEmitter {
  private prisma: PrismaClientLike;
  private producer: Producer;
  private config: OutboxConfig;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private isProcessing: boolean = false;
  private topicMapping: Map<string, string> = new Map();

  constructor(
    prisma: PrismaClientLike,
    producer: Producer,
    config: Partial<OutboxConfig> = {}
  ) {
    super();
    this.prisma = prisma;
    this.producer = producer;
    this.config = { ...DEFAULT_OUTBOX_CONFIG, ...config };
  }

  /**
   * Register a mapping from event type to Kafka topic
   */
  registerTopicMapping(eventType: string, topic: string): void {
    this.topicMapping.set(eventType, topic);
  }

  /**
   * Store an event in the outbox within an existing transaction
   * This should be called inside a Prisma transaction callback
   */
  async storeEvent(
    tx: PrismaClientLike,
    event: OutboxEventInput
  ): Promise<OutboxEvent> {
    return tx.outboxEvent.create({
      data: {
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload,
        headers: event.headers || null,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: this.config.maxAttempts,
      },
    }) as Promise<OutboxEvent>;
  }

  /**
   * Store multiple events atomically
   */
  async storeEvents(
    tx: PrismaClientLike,
    events: OutboxEventInput[]
  ): Promise<OutboxEvent[]> {
    return tx.outboxEvent.createMany({
      data: events.map((e) => ({
        aggregateId: e.aggregateId,
        eventType: e.eventType,
        payload: e.payload,
        headers: e.headers || null,
        status: 'PENDING' as OutboxStatus,
        attempts: 0,
        maxAttempts: this.config.maxAttempts,
      })),
    }).then(() => 
      tx.outboxEvent.findMany({
        where: {
          aggregateId: { in: events.map(e => e.aggregateId) },
          status: 'PENDING',
        },
        orderBy: { createdAt: 'desc' },
        take: events.length,
      })
    ) as Promise<OutboxEvent[]>;
  }

  /**
   * Start the background publisher
   */
  start(): void {
    if (!this.config.enabled) {
      return;
    }

    this.pollingInterval = setInterval(() => {
      this.processPendingEvents();
    }, this.config.pollingIntervalMs);

    this.emit('started');
  }

  /**
   * Stop the background publisher
   */
  async stop(): Promise<void> {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    // Wait for current processing to complete
    while (this.isProcessing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.emit('stopped');
  }

  /**
   * Process pending events in batches
   */
  private async processPendingEvents(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      const events = await this.fetchPendingEvents();

      if (events.length === 0) {
        return;
      }

      this.emit('processing', { count: events.length });

      for (const event of events) {
        await this.processEvent(event);
      }
    } catch (error) {
      this.emit('error', { error, phase: 'processPendingEvents' });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Fetch pending events that are ready for processing
   */
  private async fetchPendingEvents(): Promise<OutboxEvent[]> {
    return this.prisma.outboxEvent.findMany({
      where: {
        status: 'PENDING',
        OR: [
          { nextRetryAt: null },
          { nextRetryAt: { lte: new Date() } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: this.config.batchSize,
    }) as Promise<OutboxEvent[]>;
  }

  /**
   * Process a single event
   */
  private async processEvent(event: OutboxEvent): Promise<void> {
    // Mark as processing
    await this.prisma.outboxEvent.update({
      where: { id: event.id },
      data: { status: 'PROCESSING' as OutboxStatus },
    });

    try {
      const topic = this.topicMapping.get(event.eventType) || this.inferTopic(event.eventType);

      const message: Message = {
        key: event.aggregateId,
        value: JSON.stringify(event.payload),
        headers: {
          'event-type': event.eventType,
          'event-id': event.id,
          'aggregate-id': event.aggregateId,
          'idempotency-key': event.id, // Prevent duplicate processing
          'timestamp': new Date().toISOString(),
          ...(event.headers as Record<string, string> || {}),
        },
      };

      await this.producer.send({
        topic,
        messages: [message],
      });

      // Mark as published
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'PUBLISHED' as OutboxStatus,
          processedAt: new Date(),
        },
      });

      this.emit('published', { eventId: event.id, eventType: event.eventType });
    } catch (error) {
      await this.handlePublishError(event, error as Error);
    }
  }

  /**
   * Handle publishing errors with retry logic
   */
  private async handlePublishError(event: OutboxEvent, error: Error): Promise<void> {
    const attempts = event.attempts + 1;
    const shouldRetry = attempts < event.maxAttempts;

    if (shouldRetry) {
      const nextRetryDelay = this.calculateBackoff(attempts);
      const nextRetryAt = new Date(Date.now() + nextRetryDelay);

      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'PENDING' as OutboxStatus,
          attempts,
          nextRetryAt,
        },
      });

      this.emit('retry', {
        eventId: event.id,
        attempt: attempts,
        nextRetryAt,
        error,
      });
    } else {
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'FAILED' as OutboxStatus,
          attempts,
        },
      });

      this.emit('failed', {
        eventId: event.id,
        eventType: event.eventType,
        attempts,
        error,
      });
    }
  }

  /**
   * Calculate exponential backoff with jitter
   */
  private calculateBackoff(attempt: number): number {
    const baseDelay = this.config.retryBaseDelayMs;
    const maxDelay = this.config.retryMaxDelayMs;
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    const jitter = Math.random() * 0.1 * exponentialDelay;
    return Math.floor(exponentialDelay + jitter);
  }

  /**
   * Infer Kafka topic from event type
   */
  private inferTopic(eventType: string): string {
    // Convert event type like "TaskCreated" to "tasks.events"
    const entity = eventType.replace(/^(Created|Updated|Deleted|Failed|Completed)/, '').toLowerCase();
    return `${entity}.events`;
  }

  /**
   * Get statistics about the outbox
   */
  async getStats(): Promise<{
    pending: number;
    processing: number;
    published: number;
    failed: number;
    oldestPending?: Date;
  }> {
    const [pending, processing, published, failed, oldestPending] = await Promise.all([
      this.prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
      this.prisma.outboxEvent.count({ where: { status: 'PROCESSING' } }),
      this.prisma.outboxEvent.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.outboxEvent.count({ where: { status: 'FAILED' } }),
      this.prisma.outboxEvent.findFirst({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    return {
      pending,
      processing,
      published,
      failed,
      oldestPending: oldestPending?.createdAt,
    };
  }

  /**
   * Manually retry failed events
   */
  async retryFailed(eventIds?: string[]): Promise<number> {
    const where = eventIds
      ? { id: { in: eventIds }, status: 'FAILED' as OutboxStatus }
      : { status: 'FAILED' as OutboxStatus };

    const result = await this.prisma.outboxEvent.updateMany({
      where,
      data: {
        status: 'PENDING' as OutboxStatus,
        attempts: 0,
        nextRetryAt: null,
      },
    });

    this.emit('retry_requested', { count: result.count });
    return result.count;
  }
}
