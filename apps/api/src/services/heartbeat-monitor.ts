import { NodeStatus, PrismaClient, Task } from '@prisma/client';
import Redis from 'ioredis';
import type { Logger } from 'pino';
import { tracer } from '@edgecloud/shared-kernel';
import { SpanStatusCode } from '@opentelemetry/api';

import type { WebSocketManager } from './websocket-manager';
import type { TaskScheduler } from './task-scheduler';

const HEARTBEAT_TIMEOUT = 30000; // 30 seconds
const CHECK_INTERVAL = 10000; // 10 seconds

export class HeartbeatMonitor {
  private prisma: PrismaClient;
  private wsManager: WebSocketManager;
  private logger: Logger;
  private interval: NodeJS.Timeout | null = null;
  private taskScheduler: TaskScheduler | null = null;

  constructor(
    prisma: PrismaClient,
    _redis: Redis,
    wsManager: WebSocketManager,
    logger: Logger,
  ) {
    this.prisma = prisma;
    this.wsManager = wsManager;
    this.logger = logger;
  }

  start(): void {
    this.interval = setInterval(() => this.checkNodes(), CHECK_INTERVAL);
  }

  setTaskScheduler(taskScheduler: TaskScheduler): void {
    this.taskScheduler = taskScheduler;
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async checkNodes(): Promise<void> {
    await tracer.startActiveSpan(
      'orchestrator:heartbeat_check',
      async (span) => {
        try {
          const now = new Date();
          const timeoutThreshold = new Date(now.getTime() - HEARTBEAT_TIMEOUT);

          // Find nodes that haven't sent heartbeat recently
          const staleNodes = await this.prisma.edgeNode.findMany({
            where: {
              status: NodeStatus.ONLINE,
              lastHeartbeat: { lt: timeoutThreshold },
              isMaintenanceMode: false,
            },
          });

          span.setAttribute('monitor.stale_nodes_count', staleNodes.length);

          for (const node of staleNodes) {
            // Update node status
            await this.prisma.edgeNode.update({
              where: { id: node.id },
              data: { status: NodeStatus.OFFLINE },
            });

            // Handle running tasks on this node
            await this.handleNodeFailure(node.id);

            // Broadcast status change
            this.wsManager.broadcast('node:status_changed', {
              nodeId: node.id,
              status: 'OFFLINE',
              reason: 'heartbeat_timeout',
              timestamp: now.toISOString(),
            });

            // Create alert
            await this.prisma.alert.create({
              data: {
                ruleId: 'heartbeat-timeout',
                entityId: node.id,
                entityType: 'node',
                severity: 'high',
                message: `Node ${node.name} went offline due to heartbeat timeout`,
                tenantId: node.tenantId,
              },
            });
          }

          // Check for degraded nodes
          const degradedNodes = await this.prisma.edgeNode.findMany({
            where: {
              status: NodeStatus.ONLINE,
              OR: [{ cpuUsage: { gt: 90 } }, { memoryUsage: { gt: 90 } }],
            },
          });

          span.setAttribute(
            'monitor.degraded_nodes_count',
            degradedNodes.length,
          );

          for (const node of degradedNodes) {
            await this.prisma.edgeNode.update({
              where: { id: node.id },
              data: { status: NodeStatus.DEGRADED },
            });

            this.wsManager.broadcast('node:status_changed', {
              nodeId: node.id,
              status: 'DEGRADED',
              reason: 'high_resource_usage',
              cpuUsage: node.cpuUsage,
              memoryUsage: node.memoryUsage,
              timestamp: now.toISOString(),
            });
          }

          // Check for recovered nodes (degraded -> online)
          const recoveredNodes = await this.prisma.edgeNode.findMany({
            where: {
              status: NodeStatus.DEGRADED,
              cpuUsage: { lt: 80 },
              memoryUsage: { lt: 80 },
              lastHeartbeat: { gte: timeoutThreshold },
            },
          });

          span.setAttribute(
            'monitor.recovered_nodes_count',
            recoveredNodes.length,
          );

          for (const node of recoveredNodes) {
            await this.prisma.edgeNode.update({
              where: { id: node.id },
              data: { status: NodeStatus.ONLINE },
            });

            this.wsManager.broadcast('node:status_changed', {
              nodeId: node.id,
              status: 'ONLINE',
              reason: 'recovered',
              timestamp: now.toISOString(),
            });
          }
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (error: unknown) {
          const err = error as Error;
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR });
          this.logger.error({ error: err }, 'Error in heartbeat monitor');
        } finally {
          span.end();
        }
      },
    );
  }

  private async handleNodeFailure(nodeId: string): Promise<void> {
    // Find running tasks on failed node
    const runningTasks = await this.prisma.task.findMany({
      where: {
        nodeId,
        status: 'RUNNING',
      },
    });

    for (const task of runningTasks) {
      this.logger.info(
        { taskId: task.id, nodeId },
        'Rescheduling task from failed node',
      );

      // Mark task as failed
      const previousExecution = await this.prisma.taskExecution.findFirst({
        where: { taskId: task.id },
        orderBy: { attemptNumber: 'desc' },
      });

      await this.prisma.$transaction([
        this.prisma.task.update({
          where: { id: task.id },
          data: {
            status: 'FAILED',
          },
        }),
        ...(previousExecution
          ? [
              this.prisma.taskExecution.update({
                where: { id: previousExecution.id },
                data: {
                  status: 'FAILED',
                  error: 'Node offline',
                  completedAt: new Date(),
                },
              }),
            ]
          : []),
      ]);

      // Create retry execution if under max retries
      const executionCount = await this.prisma.taskExecution.count({
        where: { taskId: task.id },
      });
      if (executionCount < task.maxRetries) {
        await this.prisma.taskExecution.create({
          data: {
            taskId: task.id,
            status: 'PENDING',
            attemptNumber: executionCount + 1,
            retryOf: previousExecution?.id ?? null,
            tenantId: task.tenantId,
          },
        });

        const updatedTask = await this.prisma.task.update({
          where: { id: task.id },
          data: {
            status: 'PENDING',
            nodeId: null,
          },
        });

        if (this.taskScheduler) {
          await this.taskScheduler.enqueue(updatedTask as Task);
        }
      }

      this.wsManager.broadcast('task:failed', {
        taskId: task.id,
        nodeId,
        reason: 'node_offline',
      });
    }
  }
}
