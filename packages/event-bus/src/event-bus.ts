import { Kafka, Producer, Consumer, Message } from 'kafkajs';
import { DomainEvent, generateEventId, generateCorrelationId } from '@edgecloud/shared-kernel';

export interface EventBusConfig {
  brokers: string[];
  clientId: string;
  retry?: {
    maxRetries: number;
    retries: number;
  };
}

export interface PublishOptions {
  correlationId?: string;
  partition?: number;
  headers?: Record<string, string>;
}

export type EventHandler<T extends DomainEvent> = (event: T) => Promise<void>;

export class EventBus {
  private kafka: Kafka;
  private producer: Producer;
  private consumers: Map<string, Consumer> = new Map();
  private isConnected: boolean = false;

  constructor(private config: EventBusConfig) {
    this.kafka = new Kafka({
      clientId: config.clientId,
      brokers: config.brokers,
      retry: config.retry || { maxRetries: 5, retries: 5 },
    });

    this.producer = this.kafka.producer({
      idempotent: true,
      transactionalId: config.clientId,
    });
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;
    
    await this.producer.connect();
    this.isConnected = true;
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
    
    for (const consumer of this.consumers.values()) {
      await consumer.disconnect();
    }
    
    this.isConnected = false;
  }

  async publish<T extends DomainEvent>(
    topic: string,
    event: Omit<T, 'eventId' | 'timestamp'>,
    options?: PublishOptions
  ): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }

    const fullEvent: DomainEvent = {
      ...event,
      eventId: generateEventId(),
      timestamp: new Date(),
    };

    const message: Message = {
      key: fullEvent.aggregateId,
      value: JSON.stringify(fullEvent),
      headers: {
        'event-type': fullEvent.eventType,
        'correlation-id': options?.correlationId || generateCorrelationId(),
        'timestamp': fullEvent.timestamp.toISOString(),
        ...options?.headers,
      },
    };

    await this.producer.send({
      topic,
      messages: [message],
    });
  }

  async subscribe<T extends DomainEvent>(
    topic: string,
    groupId: string,
    handler: EventHandler<T>
  ): Promise<void> {
    const consumerKey = `${topic}:${groupId}`;
    
    if (this.consumers.has(consumerKey)) {
      throw new Error(`Consumer already exists for ${consumerKey}`);
    }

    const consumer = this.kafka.consumer({
      groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });

    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ message }: { message: Message }) => {
        if (!message.value) return;

        try {
          const event = JSON.parse(message.value.toString()) as T;
          await handler(event);
        } catch (error) {
          console.error(`Error handling event from ${topic}:`, error);
          // In production, send to dead letter queue
        }
      },
    });

    this.consumers.set(consumerKey, consumer);
  }

  async createTopics(topics: Array<{ topic: string; partitions: number; replicationFactor: number }>): Promise<void> {
    const admin = this.kafka.admin();
    await admin.connect();

    const existingTopics = await admin.listTopics();
    const topicsToCreate = topics.filter(t => !existingTopics?.includes(t.topic));
    
    if (topicsToCreate.length > 0) {
      await admin.createTopics({
        topics: topicsToCreate.map(t => ({
          topic: t.topic,
          numPartitions: t.partitions,
          replicationFactor: t.replicationFactor,
        })),
      });
    }

    await admin.disconnect();
  }
}

// Topic definitions
export const TOPICS = {
  TASK_COMMANDS: 'tasks.commands',
  TASK_EVENTS: 'tasks.events',
  NODE_COMMANDS: 'nodes.commands',
  NODE_EVENTS: 'nodes.events',
  METRICS: 'metrics.raw',
  METRICS_RAW: 'metrics.raw',
  METRICS_AGGREGATED: 'metrics.aggregated',
  SCHEDULER_DECISIONS: 'scheduler.decisions',
  SYSTEM_ALERTS: 'system.alerts',
} as const;

export const DEFAULT_TOPIC_CONFIG = [
  { topic: TOPICS.TASK_COMMANDS, partitions: 12, replicationFactor: 3 },
  { topic: TOPICS.TASK_EVENTS, partitions: 12, replicationFactor: 3 },
  { topic: TOPICS.NODE_COMMANDS, partitions: 6, replicationFactor: 3 },
  { topic: TOPICS.NODE_EVENTS, partitions: 6, replicationFactor: 3 },
  { topic: TOPICS.METRICS_RAW, partitions: 24, replicationFactor: 3 },
  { topic: TOPICS.METRICS_AGGREGATED, partitions: 6, replicationFactor: 3 },
  { topic: TOPICS.SCHEDULER_DECISIONS, partitions: 6, replicationFactor: 3 },
  { topic: TOPICS.SYSTEM_ALERTS, partitions: 3, replicationFactor: 3 },
];
