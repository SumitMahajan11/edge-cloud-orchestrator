/**
 * Task Queue Integration with Kafka, RabbitMQ, and Redis Streams support
 * Provides reliable message queuing for task distribution
 */

import { logger } from '../logger'
import type { Task, TaskPriority } from '../../types'

// Types
export interface QueueConfig {
  type: 'kafka' | 'rabbitmq' | 'redis' | 'memory'
  brokers?: string[]
  url?: string
  topic?: string
  queue?: string
  consumerGroup?: string
  prefetch?: number
  retryPolicy?: RetryPolicy
}

export interface RetryPolicy {
  maxRetries: number
  initialDelay: number
  maxDelay: number
  multiplier: number
}

export interface QueueMessage {
  id: string
  task: Task
  priority: TaskPriority
  createdAt: number
  retryCount: number
  scheduledFor?: number
}

export interface QueueStats {
  pending: number
  processing: number
  completed: number
  failed: number
  totalProcessed: number
  avgLatency: number
  throughput: number // messages per second
}

export type QueueEvent = 'message.produced' | 'message.consumed' | 'message.failed' | 'message.retry'
export type QueueCallback = (event: QueueEvent, data: unknown) => void

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  multiplier: 2,
}

/**
 * Abstract Queue Adapter
 */
abstract class QueueAdapter {
  abstract connect(): Promise<void>
  abstract disconnect(): Promise<void>
  abstract produce(message: QueueMessage): Promise<void>
  abstract consume(handler: (message: QueueMessage) => Promise<void>): Promise<void>
  abstract getStats(): QueueStats
  abstract ack(messageId: string): Promise<void>
  abstract nack(messageId: string, requeue?: boolean): Promise<void>
}

/**
 * In-Memory Queue Adapter (for development/testing)
 */
class MemoryQueueAdapter extends QueueAdapter {
  private queues: Map<TaskPriority, QueueMessage[]> = new Map()
  private processing: Map<string, QueueMessage> = new Map()
  private stats: QueueStats = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    totalProcessed: 0,
    avgLatency: 0,
    throughput: 0,
  }
  private handlers: Array<(message: QueueMessage) => Promise<void>> = []
  private isConsuming = false
  private latencySum = 0
  private startTime = Date.now()

  constructor() {
    super()
    ;(['critical', 'high', 'medium', 'low'] as TaskPriority[]).forEach(p => {
      this.queues.set(p, [])
    })
  }

  async connect(): Promise<void> {
    logger.info('Memory queue adapter connected')
  }

  async disconnect(): Promise<void> {
    this.isConsuming = false
    logger.info('Memory queue adapter disconnected')
  }

  async produce(message: QueueMessage): Promise<void> {
    const queue = this.queues.get(message.priority)
    if (queue) {
      // Priority insert: critical first
      if (message.priority === 'critical') {
        queue.unshift(message)
      } else {
        queue.push(message)
      }
      this.stats.pending++
    }
  }

  async consume(handler: (message: QueueMessage) => Promise<void>): Promise<void> {
    this.handlers.push(handler)
    
    if (!this.isConsuming) {
      this.isConsuming = true
      this.processQueue()
    }
  }

  private async processQueue(): Promise<void> {
    while (this.isConsuming) {
      const message = this.getNextMessage()
      
      if (message) {
        this.processing.set(message.id, message)
        this.stats.pending--
        this.stats.processing++

        for (const handler of this.handlers) {
          try {
            await handler(message)
          } catch (error) {
            logger.error('Queue handler error', error as Error, { messageId: message.id })
          }
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
  }

  private getNextMessage(): QueueMessage | null {
    // Priority order: critical > high > medium > low
    const priorities: TaskPriority[] = ['critical', 'high', 'medium', 'low']
    
    for (const priority of priorities) {
      const queue = this.queues.get(priority)
      if (queue && queue.length > 0) {
        return queue.shift() || null
      }
    }
    
    return null
  }

  getStats(): QueueStats {
    this.stats.throughput = this.stats.totalProcessed / ((Date.now() - this.startTime) / 1000)
    return { ...this.stats }
  }

  async ack(messageId: string): Promise<void> {
    const message = this.processing.get(messageId)
    if (message) {
      this.processing.delete(messageId)
      this.stats.processing--
      this.stats.completed++
      this.stats.totalProcessed++
      this.latencySum += Date.now() - message.createdAt
      this.stats.avgLatency = this.latencySum / this.stats.completed
    }
  }

  async nack(messageId: string, requeue = true): Promise<void> {
    const message = this.processing.get(messageId)
    if (message) {
      this.processing.delete(messageId)
      this.stats.processing--

      if (requeue && message.retryCount < 3) {
        message.retryCount++
        await this.produce(message)
      } else {
        this.stats.failed++
      }
    }
  }
}

/**
 * Kafka Queue Adapter
 */
class KafkaQueueAdapter extends QueueAdapter {
  private config: QueueConfig
  private producer: unknown = null
  private consumer: unknown = null
  private stats: QueueStats = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    totalProcessed: 0,
    avgLatency: 0,
    throughput: 0,
  }
  private messageCallbacks: Map<string, (message: QueueMessage) => Promise<void>> = new Map()

  constructor(config: QueueConfig) {
    super()
    this.config = config
  }

  async connect(): Promise<void> {
    try {
      // Dynamic import for Node.js environment
      // @ts-expect-error - Optional dependency
      const { Kafka } = await import('kafkajs')
      
      const kafka = new Kafka({
        brokers: this.config.brokers || ['localhost:9092'],
      })

      this.producer = kafka.producer()
      this.consumer = kafka.consumer({ 
        groupId: this.config.consumerGroup || 'edge-cloud-orchestrator' 
      })

      await (this.producer as { connect: () => Promise<void> }).connect()
      await (this.consumer as { connect: () => Promise<void> }).connect()

      await (this.consumer as { subscribe: (opts: { topic: string; fromBeginning: boolean }) => Promise<void> }).subscribe({
        topic: this.config.topic || 'tasks',
        fromBeginning: false,
      })

      logger.info('Kafka adapter connected', { brokers: this.config.brokers })
    } catch (error) {
      logger.error('Failed to connect to Kafka', error as Error)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.producer) {
        await (this.producer as { disconnect: () => Promise<void> }).disconnect()
      }
      if (this.consumer) {
        await (this.consumer as { disconnect: () => Promise<void> }).disconnect()
      }
      logger.info('Kafka adapter disconnected')
    } catch (error) {
      logger.error('Error disconnecting from Kafka', error as Error)
    }
  }

  async produce(message: QueueMessage): Promise<void> {
    if (!this.producer) {
      throw new Error('Kafka producer not connected')
    }

    await (this.producer as { send: (opts: { topic: string; messages: Array<{ key: string; value: string; headers?: Record<string, string> }> }) => Promise<void> }).send({
      topic: this.config.topic || 'tasks',
      messages: [{
        key: message.id,
        value: JSON.stringify(message),
        headers: {
          priority: message.priority,
          'created-at': message.createdAt.toString(),
        },
      }],
    })

    this.stats.pending++
  }

  async consume(handler: (message: QueueMessage) => Promise<void>): Promise<void> {
    if (!this.consumer) {
      throw new Error('Kafka consumer not connected')
    }

    await (this.consumer as { run: (opts: { eachMessage: (payload: { message: { key: unknown; value: unknown } }) => Promise<void> }) => Promise<void> }).run({
      eachMessage: async ({ message }) => {
        const key = (message.key as Uint8Array | null)?.toString()
        const value = (message.value as Uint8Array | null)?.toString()
        
        if (!key || !value) return

        try {
          const queueMessage: QueueMessage = JSON.parse(value)
          this.messageCallbacks.set(key, handler)
          this.stats.processing++
          await handler(queueMessage)
        } catch (error) {
          logger.error('Kafka message processing error', error as Error, { key })
          this.stats.failed++
        }
      },
    })
  }

  getStats(): QueueStats {
    return { ...this.stats }
  }

  async ack(messageId: string): Promise<void> {
    this.stats.processing--
    this.stats.completed++
    this.stats.totalProcessed++
    this.messageCallbacks.delete(messageId)
  }

  async nack(messageId: string, _requeue = true): Promise<void> {
    this.stats.processing--
    this.stats.failed++
    this.messageCallbacks.delete(messageId)
  }
}

/**
 * RabbitMQ Queue Adapter
 */
class RabbitMQQueueAdapter extends QueueAdapter {
  private config: QueueConfig
  private connection: unknown = null
  private channel: unknown = null
  private stats: QueueStats = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    totalProcessed: 0,
    avgLatency: 0,
    throughput: 0,
  }

  constructor(config: QueueConfig) {
    super()
    this.config = config
  }

  async connect(): Promise<void> {
    try {
      // @ts-expect-error - Optional dependency
      const amqp = await import('amqplib')
      
      this.connection = await amqp.connect(this.config.url || 'amqp://localhost')
      this.channel = await (this.connection as { createChannel: () => Promise<unknown> }).createChannel()

      const queue = this.config.queue || 'tasks'
      await (this.channel as { assertQueue: (queue: string, opts?: { durable?: boolean }) => Promise<void> }).assertQueue(queue, {
        durable: true,
      })

      await (this.channel as { prefetch: (count: number) => Promise<void> }).prefetch(this.config.prefetch || 10)

      logger.info('RabbitMQ adapter connected', { url: this.config.url })
    } catch (error) {
      logger.error('Failed to connect to RabbitMQ', error as Error)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.channel) {
        await (this.channel as { close: () => Promise<void> }).close()
      }
      if (this.connection) {
        await (this.connection as { close: () => Promise<void> }).close()
      }
      logger.info('RabbitMQ adapter disconnected')
    } catch (error) {
      logger.error('Error disconnecting from RabbitMQ', error as Error)
    }
  }

  async produce(message: QueueMessage): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not connected')
    }

    const queue = this.config.queue || 'tasks'
    
    await (this.channel as { sendToQueue: (queue: string, content: Uint8Array, opts?: { priority?: number }) => Promise<void> }).sendToQueue(
      queue,
      new TextEncoder().encode(JSON.stringify(message)),
      { priority: this.getPriorityValue(message.priority) }
    )

    this.stats.pending++
  }

  private getPriorityValue(priority: TaskPriority): number {
    switch (priority) {
      case 'critical': return 10
      case 'high': return 7
      case 'medium': return 5
      case 'low': return 2
      default: return 5
    }
  }

  async consume(handler: (message: QueueMessage) => Promise<void>): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not connected')
    }

    const queue = this.config.queue || 'tasks'

    await (this.channel as { consume: (queue: string, callback: (msg: { content: Uint8Array; fields: { deliveryTag: number } } | null) => Promise<void>) => Promise<void> }).consume(queue, async (msg) => {
      if (!msg) return

      this.stats.processing++
      
      try {
        const message: QueueMessage = JSON.parse(new TextDecoder().decode(msg.content))
        await handler(message)
      } catch (error) {
        logger.error('RabbitMQ message processing error', error as Error)
        this.stats.failed++
      }
    })
  }

  getStats(): QueueStats {
    return { ...this.stats }
  }

  async ack(_messageId: string): Promise<void> {
    this.stats.processing--
    this.stats.completed++
    this.stats.totalProcessed++
  }

  async nack(_messageId: string, _requeue = true): Promise<void> {
    this.stats.processing--
    this.stats.failed++
  }
}

/**
 * Redis Streams Queue Adapter
 */
class RedisStreamsAdapter extends QueueAdapter {
  private config: QueueConfig
  private redisClient: unknown = null
  private consumerGroup: string
  private consumerName: string
  private streamKey: string
  private stats: QueueStats = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    totalProcessed: 0,
    avgLatency: 0,
    throughput: 0,
  }
  private pendingMessages: Map<string, QueueMessage> = new Map()

  constructor(config: QueueConfig) {
    super()
    this.config = config
    this.streamKey = config.topic || 'tasks'
    this.consumerGroup = config.consumerGroup || 'edge-cloud-workers'
    this.consumerName = `consumer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  async connect(): Promise<void> {
    try {
      // @ts-expect-error - Optional dependency
      const { createClient } = await import('redis')
      
      this.redisClient = createClient({
        url: this.config.url || 'redis://localhost:6379',
      })

      const client = this.redisClient as {
        connect: () => Promise<void>
        on: (event: string, cb: (err: Error) => void) => void
        xGroup: (command: string, ...args: string[]) => Promise<void>
      }

      client.on('error', (err: Error) => {
        logger.error('Redis client error', err)
      })

      await client.connect()

      // Create consumer group if not exists
      try {
        await client.xGroup('CREATE', this.streamKey, this.consumerGroup, '0', 'MKSTREAM')
      } catch {
        // Group already exists, ignore
      }

      logger.info('Redis Streams adapter connected', { url: this.config.url })
    } catch (error) {
      logger.error('Failed to connect to Redis', error as Error)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.redisClient) {
        await (this.redisClient as { quit: () => Promise<void> }).quit()
      }
      logger.info('Redis Streams adapter disconnected')
    } catch (error) {
      logger.error('Error disconnecting from Redis', error as Error)
    }
  }

  async produce(message: QueueMessage): Promise<void> {
    if (!this.redisClient) {
      throw new Error('Redis client not connected')
    }

    const client = this.redisClient as {
      xAdd: (stream: string, id: string, fields: Record<string, string>) => Promise<string>
    }

    const fields: Record<string, string> = {
      id: message.id,
      task: JSON.stringify(message.task),
      priority: message.priority,
      createdAt: message.createdAt.toString(),
      retryCount: message.retryCount.toString(),
    }

    if (message.scheduledFor) {
      fields.scheduledFor = message.scheduledFor.toString()
    }

    await client.xAdd(this.streamKey, '*', fields)
    this.stats.pending++
  }

  async consume(handler: (message: QueueMessage) => Promise<void>): Promise<void> {
    if (!this.redisClient) {
      throw new Error('Redis client not connected')
    }

    const client = this.redisClient as {
      xReadGroup: (
        group: string,
        consumer: string,
        streams: Array<{ key: string; id: string }>,
        options?: { count: number; block: number }
      ) => Promise<Array<{ messages: Array<{ id: string; message: Record<string, string> }> }>>
      xAck: (stream: string, group: string, id: string) => Promise<void>
    }

    // Start reading from group
    const poll = async (): Promise<void> => {
      while (true) {
        try {
          const results = await client.xReadGroup(
            this.consumerGroup,
            this.consumerName,
            [{ key: this.streamKey, id: '>' }],
            { count: this.config.prefetch || 10, block: 5000 }
          )

          if (results) {
            for (const result of results) {
              for (const msg of result.messages) {
                try {
                  const message: QueueMessage = {
                    id: msg.message.id,
                    task: JSON.parse(msg.message.task),
                    priority: msg.message.priority as TaskPriority,
                    createdAt: parseInt(msg.message.createdAt, 10),
                    retryCount: parseInt(msg.message.retryCount, 10),
                  }

                  this.pendingMessages.set(msg.id, message)
                  this.stats.processing++
                  this.stats.pending--

                  await handler(message)
                  await client.xAck(this.streamKey, this.consumerGroup, msg.id)
                } catch (error) {
                  logger.error('Redis Streams message processing error', error as Error)
                  this.stats.failed++
                }
              }
            }
          }
        } catch (error) {
          logger.error('Redis Streams read error', error as Error)
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }
    }

    poll().catch(err => logger.error('Redis Streams poll error', err))
  }

  getStats(): QueueStats {
    return { ...this.stats }
  }

  async ack(messageId: string): Promise<void> {
    this.pendingMessages.delete(messageId)
    this.stats.processing--
    this.stats.completed++
    this.stats.totalProcessed++
  }

  async nack(messageId: string, _requeue = true): Promise<void> {
    this.pendingMessages.delete(messageId)
    this.stats.processing--
    this.stats.failed++
  }
}

/**
 * Task Queue Manager
 */
export class TaskQueueManager {
  private adapter: QueueAdapter
  private config: QueueConfig
  private callbacks: Map<QueueEvent, Set<QueueCallback>> = new Map()
  private retryPolicy: RetryPolicy

  constructor(config: QueueConfig) {
    this.config = config
    this.retryPolicy = config.retryPolicy || DEFAULT_RETRY_POLICY

    switch (config.type) {
      case 'kafka':
        this.adapter = new KafkaQueueAdapter(config)
        break
      case 'rabbitmq':
        this.adapter = new RabbitMQQueueAdapter(config)
        break
      case 'redis':
        this.adapter = new RedisStreamsAdapter(config)
        break
      case 'memory':
      default:
        this.adapter = new MemoryQueueAdapter()
    }
  }

  /**
   * Initialize the queue
   */
  async initialize(): Promise<void> {
    await this.adapter.connect()
    
    await this.adapter.consume(async (message) => {
      try {
        this.emit('message.consumed', { messageId: message.id, task: message.task })
        // Processing happens in scheduler
      } catch (error) {
        await this.handleFailure(message, error as Error)
      }
    })

    logger.info('Task queue initialized', { type: this.config.type })
  }

  /**
   * Shutdown the queue
   */
  async shutdown(): Promise<void> {
    await this.adapter.disconnect()
    logger.info('Task queue shutdown')
  }

  /**
   * Enqueue a task
   */
  async enqueue(task: Task): Promise<string> {
    const message: QueueMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      task,
      priority: task.priority,
      createdAt: Date.now(),
      retryCount: 0,
    }

    await this.adapter.produce(message)
    this.emit('message.produced', { messageId: message.id, taskId: task.id })

    return message.id
  }

  /**
   * Acknowledge successful processing
   */
  async ack(messageId: string): Promise<void> {
    await this.adapter.ack(messageId)
  }

  /**
   * Negative acknowledgment (failure)
   */
  async nack(messageId: string, requeue = false): Promise<void> {
    await this.adapter.nack(messageId, requeue)
  }

  /**
   * Handle message failure with retry
   */
  private async handleFailure(message: QueueMessage, error: Error): Promise<void> {
    this.emit('message.failed', { messageId: message.id, error: error.message })

    if (message.retryCount < this.retryPolicy.maxRetries) {
      message.retryCount++
      message.scheduledFor = Date.now() + this.calculateDelay(message.retryCount)
      
      await this.adapter.produce(message)
      this.emit('message.retry', { messageId: message.id, retryCount: message.retryCount })
    } else {
      await this.adapter.nack(message.id, false)
    }
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateDelay(retryCount: number): number {
    const delay = this.retryPolicy.initialDelay * Math.pow(this.retryPolicy.multiplier, retryCount)
    return Math.min(delay, this.retryPolicy.maxDelay)
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    return this.adapter.getStats()
  }

  /**
   * Subscribe to queue events
   */
  on(event: QueueEvent, callback: QueueCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: QueueEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('Queue callback error', error as Error)
      }
    })
  }
}

// Default instance (in-memory for development)
export const taskQueueManager = new TaskQueueManager({ type: 'memory' })

// Factory for creating configured instances
export function createTaskQueue(config: QueueConfig): TaskQueueManager {
  return new TaskQueueManager(config)
}
