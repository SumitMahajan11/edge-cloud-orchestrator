/**
 * Kafka Exactly-Once Processing (EOS)
 * 
 * Guarantees:
 * - No duplicate processing (idempotent producer)
 * - No lost messages (transactional consumer)
 * - Atomic "consume-process-produce" cycles
 * 
 * Uses Kafka transactions + idempotent producer + consumer group offsets
 */

import { Kafka, Producer, Consumer, Transaction, RecordMetadata } from 'kafkajs';
import Redis from 'ioredis';
import type { Logger } from 'pino';
import type { PrismaClient } from '@prisma/client';

// ============================================================================
// Types
// ============================================================================

export interface EOSConfig {
  transactionalId: string;
  isolationLevel: 'read_committed' | 'read_uncommitted';
  maxInFlightRequests: number;
  transactionTimeoutMs: number;
  idempotentRetryCount: number;
}

export interface ProcessedOffset {
  topic: string;
  partition: number;
  offset: string;
  processedAt: Date;
}

export interface MessageHandler<T = unknown> {
  (message: {
    key: string | null;
    value: T;
    headers: Record<string, string>;
    topic: string;
    partition: number;
    offset: string;
  }): Promise<{
    success: boolean;
    outputTopic?: string;
    outputMessages?: Array<{
      key: string;
      value: unknown;
      headers?: Record<string, string>;
    }>;
    error?: Error;
  }>;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: EOSConfig = {
  transactionalId: 'eos-producer',
  isolationLevel: 'read_committed',
  maxInFlightRequests: 1, // Required for EOS
  transactionTimeoutMs: 60000,
  idempotentRetryCount: 3,
};

const OFFSET_CACHE_PREFIX = 'eos:offset:';
const OFFSET_CACHE_TTL = 86400; // 24 hours

// ============================================================================
// KafkaExactlyOnceService
// ============================================================================

export class KafkaExactlyOnceService {
  private kafka: Kafka;
  private producer: Producer;
  private redis: Redis;
  private prisma: PrismaClient;
  private logger: Logger;
  private config: EOSConfig;
  private isInitialized: boolean = false;

  constructor(
    kafka: Kafka,
    redis: Redis,
    prisma: PrismaClient,
    logger: Logger,
    config: Partial<EOSConfig> = {}
  ) {
    this.kafka = kafka;
    this.redis = redis;
    this.prisma = prisma;
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Create idempotent producer with transactions
    this.producer = this.kafka.producer({
      idempotent: true, // Enable idempotent producer
      transactionalId: this.config.transactionalId,
      maxInFlightRequests: this.config.maxInFlightRequests,
      transactionTimeout: this.config.transactionTimeoutMs,
      retry: {
        retries: this.config.idempotentRetryCount,
      },
    });
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    await this.producer.connect();
    this.isInitialized = true;

    this.logger.info(
      { transactionalId: this.config.transactionalId },
      'Kafka EOS service initialized'
    );
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
    this.isInitialized = false;
  }

  /**
   * Process message with exactly-once semantics
   * 
   * Steps:
   * 1. Check if already processed (deduplication)
   * 2. Start transaction
   * 3. Execute business logic
   * 4. Send output messages (if any)
   * 5. Commit consumer offset
   * 6. Commit transaction
   * 
   * If any step fails, transaction aborts and offset is not committed
   */
  async processExactlyOnce<T>(
    consumerGroupId: string,
    message: {
      topic: string;
      partition: number;
      offset: string;
      key: string | null;
      value: T;
      headers: Record<string, string>;
    },
    handler: MessageHandler<T>
  ): Promise<boolean> {
    const { topic, partition, offset, key, value, headers } = message;

    // 1. Check if already processed (fast path via Redis)
    const offsetKey = `${OFFSET_CACHE_PREFIX}${consumerGroupId}:${topic}:${partition}:${offset}`;
    const alreadyProcessed = await this.redis.get(offsetKey);

    if (alreadyProcessed) {
      this.logger.debug({ topic, partition, offset }, 'Message already processed, skipping');
      return true;
    }

    // 2. Check database for processed offset (slower but persistent)
    const dbRecord = await this.prisma.processedOffset.findUnique({
      where: {
        consumerGroup_topic_partition_offset: {
          consumerGroup: consumerGroupId,
          topic,
          partition,
          offset,
        },
      },
    });

    if (dbRecord) {
      // Cache for next time
      await this.redis.setex(offsetKey, OFFSET_CACHE_TTL, '1');
      this.logger.debug({ topic, partition, offset }, 'Message already processed (DB), skipping');
      return true;
    }

    // 3. Start transaction
    const transaction = await this.producer.transaction();

    try {
      // 4. Execute business logic
      const result = await handler({
        key,
        value,
        headers,
        topic,
        partition,
        offset,
      });

      if (!result.success) {
        throw result.error || new Error('Handler returned failure');
      }

      // 5. Send output messages within same transaction
      if (result.outputTopic && result.outputMessages && result.outputMessages.length > 0) {
        for (const msg of result.outputMessages) {
          await transaction.send({
            topic: result.outputTopic,
            messages: [
              {
                key: msg.key,
                value: JSON.stringify(msg.value),
                headers: {
                  ...msg.headers,
                  'x-eos-transaction-id': transaction.transactionId,
                  'x-source-topic': topic,
                  'x-source-partition': partition.toString(),
                  'x-source-offset': offset,
                },
              },
            ],
          });
        }
      }

      // 6. Send offsets to transaction (marks message as consumed)
      // This ensures atomic "process + commit offset"
      const consumerGroup = {
        groupId: consumerGroupId,
        memberId: '', // Will be filled by Kafka
        generationId: 0,
      };

      await transaction.sendOffsets({
        consumerGroupId,
        topics: [
          {
            topic,
            partitions: [
              {
                partition,
                offset: (parseInt(offset, 10) + 1).toString(), // Commit next offset
              },
            ],
          },
        ],
      });

      // 7. Commit transaction (atomic)
      await transaction.commit();

      // 8. Record processed offset in DB
      await this.prisma.processedOffset.create({
        data: {
          consumerGroup: consumerGroupId,
          topic,
          partition,
          offset,
          processedAt: new Date(),
        },
      });

      // 9. Cache in Redis for fast dedup
      await this.redis.setex(offsetKey, OFFSET_CACHE_TTL, '1');

      this.logger.debug(
        { topic, partition, offset, transactionId: transaction.transactionId },
        'Message processed exactly once'
      );

      return true;
    } catch (error) {
      // Abort transaction on any error
      await transaction.abort();

      this.logger.error(
        { topic, partition, offset, error: (error as Error).message },
        'Transaction aborted, message will be retried'
      );

      return false;
    }
  }

  /**
   * Send messages with exactly-once semantics
   * Uses idempotent producer + transactions
   */
  async sendExactlyOnce(
    topic: string,
    messages: Array<{
      key: string;
      value: unknown;
      headers?: Record<string, string>;
    }>,
    idempotencyKey: string
  ): Promise<RecordMetadata[]> {
    const transaction = await this.producer.transaction();

    try {
      const results: RecordMetadata[] = [];

      for (const msg of messages) {
        const result = await transaction.send({
          topic,
          messages: [
            {
              key: msg.key,
              value: JSON.stringify(msg.value),
              headers: {
                ...msg.headers,
                'x-eos-transaction-id': transaction.transactionId,
                'x-idempotency-key': idempotencyKey,
              },
            },
          ],
        });
        results.push(...result);
      }

      await transaction.commit();

      this.logger.debug(
        { topic, messageCount: messages.length, transactionId: transaction.transactionId },
        'Messages sent exactly once'
      );

      return results;
    } catch (error) {
      await transaction.abort();
      throw error;
    }
  }

  /**
   * Create consumer with read_committed isolation
   * Only sees committed messages (no uncommitted transactions)
   */
  createEOSConsumer(
    groupId: string,
    topics: string[]
  ): Consumer {
    const consumer = this.kafka.consumer({
      groupId,
      isolationLevel: this.config.isolationLevel,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });

    return consumer;
  }

  /**
   * Cleanup old processed offsets (run periodically)
   */
  async cleanupOldOffsets(maxAgeDays: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

    const result = await this.prisma.processedOffset.deleteMany({
      where: {
        processedAt: { lt: cutoffDate },
      },
    });

    this.logger.info(
      { count: result.count, maxAgeDays },
      'Cleaned up old processed offsets'
    );

    return result.count;
  }

  /**
   * Get processing statistics
   */
  async getStats(): Promise<{
    totalProcessed: number;
    uniqueTopics: number;
    uniqueConsumerGroups: number;
  }> {
    const [totalProcessed, uniqueTopics, uniqueConsumerGroups] = await Promise.all([
      this.prisma.processedOffset.count(),
      this.prisma.processedOffset.groupBy({ by: ['topic'] }).then((r) => r.length),
      this.prisma.processedOffset.groupBy({ by: ['consumerGroup'] }).then((r) => r.length),
    ]);

    return {
      totalProcessed,
      uniqueTopics,
      uniqueConsumerGroups,
    };
  }
}
