import { Permissions, v1Contracts } from '@edgecloud/shared-kernel';
import { Task, TaskExecution } from '@prisma/client';
import { FastifyInstance, FastifyRequest } from 'fastify';
import type { TenantId } from '../types/fastify.js';

import { idParamSchema, tasksLogsQuerySchema } from '../schemas';
import { deprecated } from '../utils/deprecation';
import { zodToFastifySchema } from '../utils/zod-schema';

/**
 * Transform flat Prisma task model to versioned API response schema
 */
function transformTask(task: Task & { executions?: TaskExecution[] }) {
  if (!task) {
    return null;
  }

  const metadata =
    typeof task.metadata === 'string'
      ? (JSON.parse(task.metadata) as Record<string, unknown>)
      : (task.metadata as Record<string, unknown>) || {};

  return {
    ...task,
    status: (task.status || 'PENDING').toUpperCase(),
    priority: (task.priority || 'MEDIUM').toUpperCase(),
    submittedAt: task.submittedAt.toISOString(),
    startedAt: (task.executions?.[0]?.startedAt || null)?.toISOString() || null,
    completedAt:
      (task.executions?.[0]?.completedAt || null)?.toISOString() || null,
    image: task.image || '',
    specs: (metadata.specs as Record<string, unknown>) || null,
    runtime: task.runtime,
    affinity: task.affinity,
    traceId: task.traceId,
    retryCount: Array.isArray(task.executions)
      ? Math.max(0, task.executions.length - 1)
      : 0,
    metadata: metadata,
  };
}

export default async function taskRoutes(fastify: FastifyInstance) {
  // Global hook for this plugin to surface rate limiter degradation
  fastify.addHook('onSend', async (_request, reply, payload) => {
    if (fastify.schedulerRateLimiter?.isDegraded()) {
      void reply.header('X-RateLimit-Mode', 'degraded');
    }
    return payload;
  });

  // List tasks
  fastify.get<{ Querystring: v1Contracts.TaskQueryV1 }>(
    '/',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_READ),
      ],
      schema: {
        querystring: zodToFastifySchema(v1Contracts.TaskQueryV1Schema),
        tags: ['tasks'],
        summary: 'List tasks',
        response: {
          200: {
            type: 'object',
            properties: {
              data: {
                type: 'array',
                items: zodToFastifySchema(v1Contracts.TaskV1ResponseSchema),
              },
              pagination: {
                type: 'object',
                properties: {
                  page: { type: 'number' },
                  limit: { type: 'number' },
                  total: { type: 'number' },
                  totalPages: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: v1Contracts.TaskQueryV1 }>,
      _reply,
    ) => {
      const {
        status,
        type,
        nodeId,
        priority,
        page,
        limit,
        sortBy,
        sortOrder,
        from,
        to,
      } = request.query;

      const where: import('@prisma/client').Prisma.TaskWhereInput = {
        ...(status && { status: status as any }),
        ...(type && { type: type as any }),
        ...(nodeId && { nodeId }),
        ...(priority && { priority: priority as any }),
        ...(from || to
          ? {
              submittedAt: {
                ...(from && { gte: new Date(from) }),
                ...(to && { lte: new Date(to) }),
              },
            }
          : {}),
      };

      const [tasks, total] = await Promise.all([
        request.tPrisma.task.findMany({
          where,
          orderBy: { [sortBy]: sortOrder },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            node: {
              select: { id: true, name: true, region: true },
            },
            executions: true,
          },
        }),
        request.tPrisma.task.count({ where }),
      ]);

      return {
        data: tasks.map(transformTask),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
      };
    },
  );

  // Get task by ID
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_READ),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['tasks'],
        summary: 'Get task by ID',
        response: {
          200: zodToFastifySchema(v1Contracts.TaskV1ResponseSchema),
          404: { $ref: 'ErrorSchema#' },
        },
      },
    },
    async (request, reply) => {
      const task = await request.tPrisma.task.findFirst({
        where: { id: request.params.id },
        include: {
          node: true,
          logs: {
            orderBy: { timestamp: 'desc' },
            take: 100,
          },
          executions: {
            orderBy: { scheduledAt: 'desc' },
            take: 1,
          },
        },
      });

      if (!task) {
        return reply.status(404).send({
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: 'Task not found',
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      return transformTask(task);
    },
  );

  // Get scheduling decision for a task
  fastify.get<{ Params: { id: string } }>(
    '/:id/scheduling-decision',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_READ),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['tasks'],
        summary: 'Get scheduling decision for a task',
      },
    },
    async (request, reply) => {
      const decision = await request.tPrisma.schedulingDecision.findFirst({
        where: {
          taskId: request.params.id,
        },
      });

      if (!decision) {
        return reply.status(404).send({
          error: {
            code: 'DECISION_NOT_FOUND',
            message: 'Scheduling decision not found',
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      return decision;
    },
  );

  // Create task
  fastify.post<{ Body: v1Contracts.CreateTaskV1 }>(
    '/',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_CREATE),
      ],
      preValidation: async (request: any, reply: any) => {
        const { TaskInputSchema, TaskMetadataSchema } =
          await import('@edgecloud/shared-kernel');
        if (request.body?.input) {
          const res = TaskInputSchema.safeParse(request.body.input);
          if (!res.success) {
            return reply.status(400).send({
              error: {
                code: 'BAD_REQUEST',
                message: `Invalid input payload: ${res.error.issues[0]?.message}`,
                requestId: request.id,
              },
            });
          }
        }
        if (request.body?.metadata) {
          const res = TaskMetadataSchema.safeParse(request.body.metadata);
          if (!res.success) {
            return reply.status(400).send({
              error: {
                code: 'BAD_REQUEST',
                message: `Invalid metadata payload: ${res.error.issues[0]?.message}`,
                requestId: request.id,
              },
            });
          }
        }
      },
      schema: {
        body: zodToFastifySchema(v1Contracts.CreateTaskV1Schema),
        tags: ['tasks'],
        summary: 'Create and schedule a new task',
        response: {
          201: zodToFastifySchema(v1Contracts.TaskV1ResponseSchema),
          400: { $ref: 'ErrorSchema#' },
          409: { $ref: 'ErrorSchema#' },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: v1Contracts.CreateTaskV1 }>,
      reply,
    ) => {
      const data = request.body as any;

      // If nodeId specified, verify node is available
      if (data.nodeId) {
        const node = await request.tPrisma.edgeNode.findFirst({
          where: { id: data.nodeId as string },
          include: { metrics: { take: 1, orderBy: { timestamp: 'desc' } } },
        });

        if (node && node.metrics && node.metrics.length > 0) {
          (node as any).status = 'ONLINE';
          (node as any).lastHeartbeat = node.metrics[0]!.timestamp;
        }

        if (!node || node.status !== 'ONLINE' || node.isMaintenanceMode) {
          return reply.status(400).send({
            error: {
              code: 'BAD_REQUEST',
              message: 'Node not available',
              requestId: request.id,
            },
          });
        }
      }

      const tenantId = request.user!.tenantId!;

      const task = await request.tPrisma.task.create({
        data: {
          name: data.name,
          type: data.type,
          priority: data.priority,
          target: data.target,
          nodeId: data.nodeId ?? null,
          policy: 'manual',
          reason: 'Manually submitted',
          input: data.input || {},
          metadata: {
            ...(data.metadata || {}),
            specs: data.specs,
          },
          maxRetries: data.maxRetries,
          runtime: data.runtime,
          image: data.image,
          affinity: data.affinity ?? null,
          traceId: data.traceId ?? null,
          tenantId,
          executions: {
            create: {
              status: 'PENDING',
              attemptNumber: 1,
              tenantId: tenantId,
            },
          },
        },
        include: {
          node: {
            select: { id: true, name: true, region: true },
          },
          executions: { orderBy: { attemptNumber: 'desc' }, take: 1 },
        },
      });

      // Add to task queue
      await fastify.taskScheduler.enqueue(task);

      // Record metric
      fastify.taskScheduler.recordTaskSubmission(task.priority, tenantId);

      // Audit log
      await request.tPrisma.auditLog.create({
        data: {
          userId: request.user!.id,
          tenantId: tenantId,
          action: 'task.created',
          entityType: 'task',
          entityId: task.id,
          details: { name: task.name, type: task.type } as any,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
      });

      // Broadcast via WebSocket
      fastify.log.info({ taskId: task.id }, 'Broadcasting task:created');
      fastify.wsManager.broadcastToTenant(
        task.tenantId as TenantId,
        'task:created',
        task,
      );

      return reply.status(201).send(transformTask(task));
    },
  );

  // Cancel task
  fastify.post<{ Params: { id: string } }>(
    '/:id/cancel',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_CANCEL),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['tasks'],
        summary: 'Cancel a task',
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const task = await request.tPrisma.task.findUnique({ where: { id } });

      if (!task) {
        return reply.status(404).send({
          error: {
            code: 'TASK_NOT_FOUND',
            message: 'Task not found',
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      if (!['PENDING', 'SCHEDULED', 'RUNNING'].includes(task.status)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_TASK_STATE',
            message: 'Task cannot be cancelled in its current state',
            requestId: request.id,
          },
        });
      }

      const updated = await request.tPrisma.task.update({
        where: { id },
        data: {
          status: 'CANCELLED',
        },
      });

      // Broadcast via WebSocket
      fastify.wsManager.broadcastToTenant(
        updated.tenantId as TenantId,
        'task:cancelled',
        updated,
      );

      return updated;
    },
  );

  // Retry task
  fastify.post<{ Params: { id: string } }>(
    '/:id/retry',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_ADMIN),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['tasks'],
        summary: 'Retry a failed task',
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const task = await request.tPrisma.task.findUnique({ where: { id } });

      if (!task) {
        return reply.status(404).send({
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: 'Task not found',
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      if (task.status !== 'FAILED') {
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: 'Only failed tasks can be retried',
            requestId: request.id,
          },
        });
      }

      // Check existing execution count instead of retryCount field
      const executionCount = await request.tPrisma.taskExecution.count({
        where: { taskId: id },
      });
      if (executionCount >= task.maxRetries) {
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: 'Max retries exceeded',
            requestId: request.id,
          },
        });
      }

      const previousExecution = await (
        request.tPrisma as any
      ).taskExecution.findFirst({
        where: { taskId: id },
        orderBy: { attemptNumber: 'desc' },
      });

      // Reset existing task and create new execution record
      await request.tPrisma.$transaction([
        request.tPrisma.task.update({
          where: { id },
          data: {
            status: 'PENDING',
            nodeId: null,
          },
        }),
        request.tPrisma.taskExecution.create({
          data: {
            taskId: id,
            status: 'PENDING',
            attemptNumber: executionCount + 1,
            tenantId: request.user!.tenantId!,
            retryOf: previousExecution?.id ?? null,
          },
        }),
      ]);

      const updatedTask = await request.tPrisma.task.findUnique({
        where: { id },
        include: {
          node: { select: { id: true, name: true, region: true } },
          executions: { orderBy: { attemptNumber: 'desc' }, take: 1 },
        },
      });

      const tUpdatedTask = updatedTask;

      if (!tUpdatedTask) {
        return reply
          .status(404)
          .send({ error: 'Task not found after creation' });
      }

      await fastify.taskScheduler.enqueue(tUpdatedTask as any);
      fastify.wsManager.broadcastToTenant(
        tUpdatedTask.tenantId as TenantId,
        'task:created',
        tUpdatedTask,
      );

      // Record metric
      fastify.taskScheduler.recordTaskSubmission(
        tUpdatedTask.priority,
        request.user!.tenantId!,
      );

      return reply.status(201).send(tUpdatedTask);
    },
  );

  // Get task logs
  fastify.get<{
    Params: { id: string };
    Querystring: { level?: string; limit?: number };
  }>(
    '/:id/logs',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_READ),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        querystring: zodToFastifySchema(tasksLogsQuerySchema),
        tags: ['tasks'],
        summary: 'Get task logs',
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { level?: string; limit?: number };
      }>,
      _reply,
    ) => {
      const { id } = request.params;
      const { level, limit = 100 } = request.query;

      const logs = await request.tPrisma.taskLog.findMany({
        where: {
          taskId: id,
          ...(level && { level: level as any }),
        },
        orderBy: { timestamp: 'desc' },
        take: limit,
      });

      return {
        data: logs,
        pagination: {
          page: 1,
          limit: logs.length || 50,
          total: logs.length,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
    },
  );

  // Task statistics (DEMO: Deprecated in V1)
  fastify.get(
    '/stats',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_READ),
      ],
      schema: {
        tags: ['tasks'],
        summary: 'Get task statistics (Deprecated)',
      },
    },
    deprecated(
      {
        deprecationDate: '2026-04-14',
        sunsetDate: '2026-10-14',
        link: 'https://docs.edgecloud.com/api/v2/stats',
      },
      async (request, _reply) => {
        const stats = await request.tPrisma.task.groupBy({
          where: {},
          by: ['status'],
          _count: true,
        });

        const byPriority = await request.tPrisma.task.groupBy({
          where: {},
          by: ['priority'],
          _count: true,
        });

        const byType = await request.tPrisma.task.groupBy({
          where: {},
          by: ['type'],
          _count: true,
        });

        return {
          byStatus: stats.reduce(
            (acc: any, s: any) => ({ ...acc, [s.status]: s._count }),
            {},
          ),
          byPriority: byPriority.reduce(
            (acc: any, p: any) => ({ ...acc, [p.priority]: p._count }),
            {},
          ),
          byType: byType.reduce(
            (acc: any, t: any) => ({ ...acc, [t.type]: t._count }),
            {},
          ),
        };
      },
    ),
  );
}
