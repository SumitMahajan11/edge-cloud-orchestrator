import { PrismaClient } from '@prisma/client'
import Redis from 'ioredis'
import type { Logger } from 'pino'
import type { WebSocketManager } from './websocket-manager'
import { NodeStatus } from '@prisma/client'

const HEARTBEAT_TIMEOUT = 30000 // 30 seconds
const CHECK_INTERVAL = 10000 // 10 seconds

export class HeartbeatMonitor {
  private prisma: PrismaClient
  private redis: Redis
  private wsManager: WebSocketManager
  private logger: Logger
  private interval: NodeJS.Timeout | null = null

  constructor(prisma: PrismaClient, redis: Redis, wsManager: WebSocketManager, logger: Logger) {
    this.prisma = prisma
    this.redis = redis
    this.wsManager = wsManager
    this.logger = logger
  }

  start() {
    this.interval = setInterval(() => this.checkNodes(), CHECK_INTERVAL)
    this.logger.info('Heartbeat monitor started')
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    this.logger.info('Heartbeat monitor stopped')
  }

  private async checkNodes() {
    try {
      const now = new Date()
      const timeoutThreshold = new Date(now.getTime() - HEARTBEAT_TIMEOUT)

      // Find nodes that haven't sent heartbeat recently
      const staleNodes = await this.prisma.edgeNode.findMany({
        where: {
          status: NodeStatus.ONLINE,
          lastHeartbeat: { lt: timeoutThreshold },
          isMaintenanceMode: false,
        },
      })

      for (const node of staleNodes) {
        this.logger.warn({ nodeId: node.id, name: node.name }, 'Node heartbeat timeout')

        // Update node status
        await this.prisma.edgeNode.update({
          where: { id: node.id },
          data: { status: NodeStatus.OFFLINE },
        })

        // Handle running tasks on this node
        await this.handleNodeFailure(node.id)

        // Broadcast status change
        this.wsManager.broadcast('node:status_changed', {
          nodeId: node.id,
          status: 'OFFLINE',
          reason: 'heartbeat_timeout',
          timestamp: now.toISOString(),
        })

        // Create alert
        await this.prisma.alert.create({
          data: {
            ruleId: 'heartbeat-timeout',
            entityId: node.id,
            entityType: 'node',
            severity: 'high',
            message: `Node ${node.name} went offline due to heartbeat timeout`,
          },
        })
      }

      // Check for degraded nodes
      const degradedNodes = await this.prisma.edgeNode.findMany({
        where: {
          status: NodeStatus.ONLINE,
          OR: [
            { cpuUsage: { gt: 90 } },
            { memoryUsage: { gt: 90 } },
          ],
        },
      })

      for (const node of degradedNodes) {
        await this.prisma.edgeNode.update({
          where: { id: node.id },
          data: { status: NodeStatus.DEGRADED },
        })

        this.wsManager.broadcast('node:status_changed', {
          nodeId: node.id,
          status: 'DEGRADED',
          reason: 'high_resource_usage',
          cpuUsage: node.cpuUsage,
          memoryUsage: node.memoryUsage,
          timestamp: now.toISOString(),
        })
      }

      // Check for recovered nodes (degraded -> online)
      const recoveredNodes = await this.prisma.edgeNode.findMany({
        where: {
          status: NodeStatus.DEGRADED,
          cpuUsage: { lt: 80 },
          memoryUsage: { lt: 80 },
          lastHeartbeat: { gte: timeoutThreshold },
        },
      })

      for (const node of recoveredNodes) {
        await this.prisma.edgeNode.update({
          where: { id: node.id },
          data: { status: NodeStatus.ONLINE },
        })

        this.wsManager.broadcast('node:status_changed', {
          nodeId: node.id,
          status: 'ONLINE',
          reason: 'recovered',
          timestamp: now.toISOString(),
        })
      }

    } catch (error) {
      this.logger.error({ error }, 'Error in heartbeat monitor')
    }
  }

  private async handleNodeFailure(nodeId: string) {
    // Find running tasks on failed node
    const runningTasks = await this.prisma.task.findMany({
      where: {
        nodeId,
        status: 'RUNNING',
      },
    })

    for (const task of runningTasks) {
      this.logger.info({ taskId: task.id, nodeId }, 'Rescheduling task from failed node')

      // Mark task as failed
      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
        },
      })

      // Create retry task if under max retries
      const executionCount = await this.prisma.taskExecution.count({ where: { taskId: task.id } })
      if (executionCount < task.maxRetries) {
        await this.prisma.task.create({
          data: {
            name: task.name,
            type: task.type,
            priority: task.priority,
            target: task.target,
            policy: task.policy,
            reason: `Retry after node failure`,
            input: task.input,
            metadata: { ...task.metadata as object, retryOf: task.id },
            maxRetries: task.maxRetries,
          } as any,
        })
      }

      this.wsManager.broadcast('task:failed', {
        taskId: task.id,
        nodeId,
        reason: 'node_offline',
      })
    }
  }
}
