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

  async start(): Promise<void> {
    try {
      const ruleExists = await this.prisma.alertRule.findUnique({
        where: { id: 'heartbeat-timeout' },
      });
      if (!ruleExists) {
        const defaultTenant = await this.prisma.tenant.findFirst();
        if (defaultTenant) {
          await this.prisma.alertRule.create({
            data: {
              id: 'heartbeat-timeout',
              name: 'Heartbeat Timeout',
              metric: 'heartbeat',
              operator: 'gt',
              threshold: 30,
              duration: 30,
              enabled: true,
              tenantId: defaultTenant.id,
            },
          });
          this.logger.info('Created heartbeat-timeout alert rule');
        } else {
          this.logger.warn('No tenant found to associate heartbeat-timeout alert rule');
        }
      }
    } catch (err) {
      this.logger.error({ err }, 'Failed to ensure heartbeat-timeout alert rule exists');
    }
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

            // Emit system log: node went offline
            await this.prisma.auditLog.create({
              data: {
                tenantId: node.tenantId,
                action: 'node.offline',
                entityType: 'node',
                entityId: node.id,
                details: {
                  nodeName: node.name,
                  reason: 'heartbeat_timeout',
                  lastHeartbeat: node.lastHeartbeat?.toISOString(),
                } as any,
              },
            }).catch((err) => this.logger.warn({ err }, 'Failed to write node.offline audit log'));

            // Handle running tasks on this node
            await this.handleNodeFailure(node.id);

            // Broadcast status change — scoped to this node's tenant
            this.wsManager.broadcast('node:status_changed', {
              nodeId: node.id,
              status: 'OFFLINE',
              reason: 'heartbeat_timeout',
              timestamp: now.toISOString(),
            }, node.tenantId);

            // Dedup: only create a new alert if no unacknowledged heartbeat-timeout
            // alert already exists for this node (state-transition firing, not poll-interval firing).
            const existingAlert = await this.prisma.alert.findFirst({
              where: {
                ruleId: 'heartbeat-timeout',
                entityId: node.id,
                acknowledged: false,
              },
            });

            if (!existingAlert) {
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

              // Emit system log: alert fired
              await this.prisma.auditLog.create({
                data: {
                  tenantId: node.tenantId,
                  action: 'warn.alert.fired',
                  entityType: 'alert',
                  entityId: node.id,
                  details: {
                    nodeName: node.name,
                    alertType: 'heartbeat_timeout',
                    severity: 'high',
                  } as any,
                },
              }).catch((err) => this.logger.warn({ err }, 'Failed to write alert.fired audit log'));

              this.logger.info(
                { nodeId: node.id, nodeName: node.name },
                'Created heartbeat-timeout alert for node transition ONLINE→OFFLINE',
              );
            } else {
              this.logger.debug(
                { nodeId: node.id, existingAlertId: existingAlert.id },
                'Skipping duplicate heartbeat alert — node already has active alert',
              );
            }
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
            }, node.tenantId);
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
            }, node.tenantId);
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
      }, task.tenantId);
    }
  }
}
