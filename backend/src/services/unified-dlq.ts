/**
 * Unified DLQ Service
 * 
 * Kafka DLQ is PRIMARY for:
 * - Persistent failed messages
 * - Long-term storage
 * - Replay capability
 * - Audit trail
 * 
 * Redis is SECONDARY for:
 * - Retry scheduling (delayed execution)
 * - Temporary caching
 * - Rate-limited retry coordination
 */

import { Kafka, Producer, Consumer } from 'kafkajs';
import Redis from 'ioredis';
import type { Logger } from 'pino';
import type { PrismaClient } from '@prisma/client';

// ============================================================================
// Types
// ============================================================================

export interface DLQMessage {
  id: string;
  originalTopic: string;
  originalPartition: number;
  originalOffset: string;
  key: string | null;
  value: Record<string, unknown>;
  headers: Record<string, string>;
  errorMessage: string;
  errorStack?: string;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  nextRetryAt?: Date;
  status: 'pending' | 'processing' | 'resolved' | 'exhausted';
}

export interface RetrySchedule {
  messageId: string;
  scheduledAt: Date;
  delayMs: number;
  priority: 'low' | 'normal' | 'high';
}

export interface DLQStats {
  pending: number;
  processing: number;
  resolved: number;
  exhausted: number;
  totalRetries: number;
}

// ============================================================================
// Constants
// ============================================================================

const DLQ_TOPIC_PREFIX = 'dlq-';
const REDIS_RETRY_QUEUE = 'dlq:retry:queue';
const REDIS_RETRY_SCHEDULE = 'dlq:retry:schedule';

const DEFAULT_RETRY_DELAYS = [1000, 5000, 30000, 60000, 300000, 900000]; // Exponential backoff

// ============================================================================
// UnifiedDLQService
// ============================================================================

export class UnifiedDLQService {
  private kafka: Kafka;
  private kafkaProducer: Producer;
  private redis: Redis;
  private prisma: PrismaClient;
  private logger: Logger;

  constructor(
    kafka: Kafka,
    redis: Redis,
    prisma: PrismaClient,
    logger: Logger
  ) {
    this.kafka = kafka;
    this.redis = redis;
    this.prisma = prisma;
    this.logger = logger;

    this.kafkaProducer = this.kafka.producer();
  }

  async initialize(): Promise<void> {
    await this.kafkaProducer.connect();
    this.logger.info('Unified DLQ Service initialized');
  }

  /**
   * Send failed message to DLQ (Kafka - PRIMARY)
   * This provides durability and replay capability
   */
  async sendToDLQ(
    originalTopic: string,
    partition: number,
    offset: string,
    message: { key: string | null; value: Record<string, unknown>; headers: Record<string, string> },
    error: Error,
    retryCount: number = 0
  ): Promise<string> {
    const dlqTopic = `${DLQ_TOPIC_PREFIX}${originalTopic}`;
    const messageId = `dlq-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const dlqMessage: DLQMessage = {
      id: messageId,
      originalTopic,
      originalPartition: partition,
      originalOffset: offset,
      key: message.key,
      value: message.value,
      headers: message.headers,
      errorMessage: error.message,
      errorStack: error.stack,
      retryCount,
      maxRetries: 5,
      createdAt: new Date(),
      status: 'pending',
    };

    // 1. Send to Kafka DLQ (persistent storage)
    await this.kafkaProducer.send({
      topic: dlqTopic,
      messages: [
        {
          key: messageId,
          value: JSON.stringify(dlqMessage),
          headers: {
            'original-topic': originalTopic,
            'error-message': error.message.substring(0, 255),
            'retry-count': retryCount.toString(),
            'created-at': new Date().toISOString(),
          },
        },
      ],
    });

    // 2. Store in database for queryability
    await this.prisma.dLQMessage.create({
      data: {
        id: messageId,
        originalTopic,
        originalPartition: partition,
        originalOffset: offset,
        messageKey: message.key,
        messageValue: message.value,
        headers: message.headers,
        errorMessage: error.message,
        errorStack: error.stack,
        retryCount,
        maxRetries: 5,
        status: 'pending',
      },
    });

    this.logger.info({
      messageId,
      originalTopic,
      retryCount,
    }, 'Message sent to DLQ');

    return messageId;
  }

  /**
   * Schedule a retry (Redis - SECONDARY)
   * Used for delayed retry execution
   */
  async scheduleRetry(
    messageId: string,
    delayMs?: number
  ): Promise<void> {
    // Get message from DB
    const message = await this.prisma.dLQMessage.findUnique({
      where: { id: messageId },
    });

    if (!message || message.status !== 'pending') {
      throw new Error(`Message ${messageId} not found or not pending`);
    }

    // Calculate delay with exponential backoff
    const delay = delayMs || DEFAULT_RETRY_DELAYS[Math.min(message.retryCount, DEFAULT_RETRY_DELAYS.length - 1)];
    const scheduledAt = new Date(Date.now() + delay);

    // Store in Redis sorted set for scheduling
    await this.redis.zadd(
      REDIS_RETRY_SCHEDULE,
      scheduledAt.getTime(),
      messageId
    );

    // Update message with next retry time
    await this.prisma.dLQMessage.update({
      where: { id: messageId },
      data: { nextRetryAt: scheduledAt },
    });

    this.logger.debug({
      messageId,
      scheduledAt,
      delay,
    }, 'Retry scheduled');
  }

  /**
   * Get messages ready for retry
   */
  async getRetryCandidates(limit: number = 100): Promise<DLQMessage[]> {
    const now = Date.now();

    // Get from Redis sorted set (scheduled retries)
    const messageIds = await this.redis.zrangebyscore(
      REDIS_RETRY_SCHEDULE,
      0,
      now,
      'LIMIT',
      0,
      limit
    );

    if (messageIds.length === 0) {
      return [];
    }

    // Get full messages from DB
    const messages = await this.prisma.dLQMessage.findMany({
      where: {
        id: { in: messageIds },
        status: 'pending',
      },
    });

    // Remove from schedule queue
    await this.redis.zrem(REDIS_RETRY_SCHEDULE, ...messageIds);

    return messages.map(m => ({
      id: m.id,
      originalTopic: m.originalTopic,
      originalPartition: m.originalPartition,
      originalOffset: m.originalOffset,
      key: m.messageKey,
      value: m.messageValue as Record<string, unknown>,
      headers: m.headers as Record<string, string>,
      errorMessage: m.errorMessage,
      errorStack: m.errorStack || undefined,
      retryCount: m.retryCount,
      maxRetries: m.maxRetries,
      createdAt: m.createdAt,
      nextRetryAt: m.nextRetryAt || undefined,
      status: m.status as 'pending' | 'processing' | 'resolved' | 'exhausted',
    }));
  }

  /**
   * Mark message as processing
   */
  async markProcessing(messageId: string): Promise<void> {
    await this.prisma.dLQMessage.update({
      where: { id: messageId },
      data: { status: 'processing' },
    });
  }

  /**
   * Mark message as resolved
   */
  async markResolved(messageId: string): Promise<void> {
    await this.prisma.dLQMessage.update({
      where: { id: messageId },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
      },
    });

    // Remove from any Redis queues
    await this.redis.zrem(REDIS_RETRY_SCHEDULE, messageId);
    await this.redis.lrem(REDIS_RETRY_QUEUE, 0, messageId);

    this.logger.info({ messageId }, 'DLQ message resolved');
  }

  /**
   * Mark message as exhausted (max retries reached)
   */
  async markExhausted(messageId: string): Promise<void> {
    await this.prisma.dLQMessage.update({
      where: { id: messageId },
      data: { status: 'exhausted' },
    });

    // Remove from Redis queues
    await this.redis.zrem(REDIS_RETRY_SCHEDULE, messageId);
    await this.redis.lrem(REDIS_RETRY_QUEUE, 0, messageId);

    this.logger.warn({ messageId }, 'DLQ message exhausted');
  }

  /**
   * Get DLQ statistics
   */
  async getStats(): Promise<DLQStats> {
    const stats = await this.prisma.dLQMessage.groupBy({
      by: ['status'],
      _count: true,
    });

    const result: DLQStats = {
      pending: 0,
      processing: 0,
      resolved: 0,
      exhausted: 0,
      totalRetries: 0,
    };

    for (const stat of stats) {
      result[stat.status as keyof DLQStats] = stat._count;
    }

    // Get total retry count
    const agg = await this.prisma.dLQMessage.aggregate({
      _sum: { retryCount: true },
    });
    result.totalRetries = agg._sum.retryCount || 0;

    return result;
  }

  /**
   * Get messages from DLQ (for admin review)
   */
  async getMessages(
    status?: 'pending' | 'processing' | 'resolved' | 'exhausted',
    limit: number = 100,
    offset: number = 0
  ): Promise<DLQMessage[]> {
    const messages = await this.prisma.dLQMessage.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return messages.map(m => ({
      id: m.id,
      originalTopic: m.originalTopic,
      originalPartition: m.originalPartition,
      originalOffset: m.originalOffset,
      key: m.messageKey,
      value: m.messageValue as Record<string, unknown>,
      headers: m.headers as Record<string, string>,
      errorMessage: m.errorMessage,
      errorStack: m.errorStack || undefined,
      retryCount: m.retryCount,
      maxRetries: m.maxRetries,
      createdAt: m.createdAt,
      nextRetryAt: m.nextRetryAt || undefined,
      status: m.status as 'pending' | 'processing' | 'resolved' | 'exhausted',
    }));
  }

  /**
   * Replay a message back to original topic
   */
  async replayMessage(messageId: string): Promise<void> {
    const message = await this.prisma.dLQMessage.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    // Increment retry count
    const newRetryCount = message.retryCount + 1;

    // Check if max retries exceeded
    if (newRetryCount > message.maxRetries) {
      await this.markExhausted(messageId);
      throw new Error('Max retries exceeded');
    }

    // Send back to original topic
    await this.kafkaProducer.send({
      topic: message.originalTopic,
      messages: [
        {
          key: message.messageKey,
          value: JSON.stringify(message.messageValue),
          headers: {
            ...message.headers as Record<string, string>,
            'x-dlq-retry-count': newRetryCount.toString(),
            'x-dlq-message-id': messageId,
          },
        },
      ],
    });

    // Update retry count
    await this.prisma.dLQMessage.update({
      where: { id: messageId },
      data: {
        retryCount: newRetryCount,
        status: 'pending',
      },
    });

    this.logger.info({
      messageId,
      originalTopic: message.originalTopic,
      retryCount: newRetryCount,
    }, 'Message replayed');
  }
}
