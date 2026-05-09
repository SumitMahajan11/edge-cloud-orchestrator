import { FastifyInstance, FastifyRequest } from 'fastify';

import { v1Contracts } from '@edgecloud/shared-kernel';
import { idParamSchema } from '../schemas';
import { zodToFastifySchema } from '../utils/zod-schema';
import { deprecated } from '../utils/deprecation';

type TaskStatusStr =
  | 'PENDING'
  | 'SCHEDULED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/**
  * Transform flat Prisma task model to versioned API response schema
  */
 function transformTask(task: any) {
   if (!task) return null;
 
   const metadata = typeof task.metadata === 'string' 
     ? JSON.parse(task.metadata) 
     : (task.metadata || {});
 
   return {
     ...task,
     status: (task.status || 'PENDING').toUpperCase(),
     priority: (task.priority || 'MEDIUM').toUpperCase(),
     submittedAt: task.submittedAt?.toISOString() || new Date().toISOString(),
     startedAt: task.startedAt?.toISOString() || null,
     completedAt: task.completedAt?.toISOString() || null,
     image: task.image || '',
     specs: metadata.specs || null,
     runtime: task.runtime,
     affinity: task.affinity,
     traceId: task.traceId,
     metadata: metadata
   };
 }
 
 export default async function taskRoutes(fastify: FastifyInstance) {
  // List tasks
  fastify.get<{ Querystring: v1Contracts.TaskQueryV1 }>(
    '/',
    {
      preHandler: [fastify.authenticate],
      schema: {
        querystring: zodToFastifySchema(v1Contracts.TaskQueryV1Schema),
        tags: ['tasks'],
        summary: 'List tasks',
        response: {
          200: {
            type: 'object',
            properties: {
              data: { type: 'array', items: zodToFastifySchema(v1Contracts.TaskV1ResponseSchema) },
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
    async (request: FastifyRequest<{ Querystring: v1Contracts.TaskQueryV1 }>, _reply) => {
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

      const where: any = {
        tenantId: request.user!.tenantId!,
        ...(status && { status: status as TaskStatusStr }),
        ...(type && { type }),
        ...(nodeId && { nodeId }),
        ...(priority && { priority }),
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
        fastify.prisma.task.findMany({
          where,
          orderBy: { [sortBy]: sortOrder },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            node: {
              select: { id: true, name: true, region: true },
            },
          },
        }),
        fastify.prisma.task.count({ where }),
      ]);

      return {
        data: tasks.map(transformTask),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
  );

  // Get task by ID
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [fastify.authenticate],
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
      const task = await fastify.prisma.task.findFirst({
        where: { id: request.params.id, tenantId: request.user!.tenantId! },
        include: {
          node: true,
          logs: {
            orderBy: { timestamp: 'desc' },
            take: 100,
          },
        },
      });

      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      return transformTask(task);
    },
  );

  // Get scheduling decision for a task
  fastify.get<{ Params: { id: string } }>(
    '/:id/scheduling-decision',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['tasks'],
        summary: 'Get scheduling decision for a task',
      },
    },
    async (request, reply) => {
      const decision = await (fastify.prisma as any).schedulingDecision.findFirst({
        where: { 
          taskId: request.params.id,
          task: { tenantId: request.user!.tenantId! }
        },
      });

      if (!decision) {
        return reply.status(404).send({ 
          code: 'DECISION_NOT_FOUND', 
          message: 'Scheduling decision not found' 
        });
      }

      return decision;
    },
  );

  // Create task
  fastify.post<{ Body: v1Contracts.CreateTaskV1 }>(
    '/',
    {
      preHandler: [fastify.authenticate],
      preValidation: async (request: any, reply: any) => {
        const { TaskInputSchema, TaskMetadataSchema } = await import('@edgecloud/shared-kernel');
        if (request.body?.input) {
          const res = TaskInputSchema.safeParse(request.body.input);
          if (!res.success) {
            return reply.status(400).send({ error: 'Invalid input payload: ' + res.error.issues[0]?.message });
          }
        }
        if (request.body?.metadata) {
          const res = TaskMetadataSchema.safeParse(request.body.metadata);
          if (!res.success) {
            return reply.status(400).send({ error: 'Invalid metadata payload: ' + res.error.issues[0]?.message });
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
    async (request: FastifyRequest<{ Body: v1Contracts.CreateTaskV1 }>, reply) => {
      const data = request.body;

      // If nodeId specified, verify node is available
      if (data.nodeId) {
        const node = await fastify.prisma.edgeNode.findFirst({
          where: { id: data.nodeId, tenantId: request.user!.tenantId! },
        });

        if (!node || node.status !== 'ONLINE' || node.isMaintenanceMode) {
          return reply.status(400).send({ error: 'Node not available' });
        }
      }

      const tenantId = request.user!.tenantId!;

      const task = await fastify.prisma.task.create({
        data: {
          name: data.name,
          type: data.type as any,
          priority: data.priority as any,
          target: data.target as any,
          nodeId: data.nodeId ?? null,
          policy: 'manual',
          reason: 'Manually submitted',
          input: (data.input || {}) as any,
          metadata: {
            ...(data.metadata || {}),
            specs: data.specs,
          } as any,
          maxRetries: data.maxRetries,
          runtime: data.runtime as any,
          image: data.image,
          affinity: data.affinity ?? null,
          traceId: data.traceId ?? null,
          tenantId,
          executions: {
            create: {
              status: 'PENDING',
              attemptNumber: 1,
              tenantId,
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
      await fastify.taskScheduler.enqueue(task as any);

      // Audit log
      await fastify.prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          tenantId: request.user!.tenantId!,
          action: 'task.created',
          entityType: 'task',
          entityId: task.id,
          details: { name: task.name, type: task.type } as any,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
      });

      // Broadcast via WebSocket
      fastify.wsManager.broadcast('task:created', task);

      return reply.status(201).send(transformTask(task));
    },
  );

  // Cancel task
  fastify.post<{ Params: { id: string } }>(
    '/:id/cancel',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['tasks'],
        summary: 'Cancel a task',
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const task = await fastify.prisma.task.findUnique({ where: { id, tenantId: request.user!.tenantId! } });

      if (!task) {
        return reply.status(404).send({ 
          code: 'TASK_NOT_FOUND', 
          message: 'Task not found' 
        });
      }

      if (!['PENDING', 'SCHEDULED', 'RUNNING'].includes(task.status)) {
        return reply.status(400).send({ 
          code: 'INVALID_TASK_STATE', 
          message: 'Task cannot be cancelled in its current state' 
        });
      }

      const updated = await fastify.prisma.task.update({
        where: { id, tenantId: request.user!.tenantId! },
        data: {
          status: 'CANCELLED' as TaskStatusStr,
        },
      });

      // Broadcast via WebSocket
      fastify.wsManager.broadcast('task:cancelled', updated);

      return updated;
    },
  );

  // Retry task
  fastify.post<{ Params: { id: string } }>(
    '/:id/retry',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['tasks'],
        summary: 'Retry a failed task',
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const task = await fastify.prisma.task.findUnique({ where: { id, tenantId: request.user!.tenantId! } });

      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      if (task.status !== 'FAILED') {
        return reply
          .status(400)
          .send({ error: 'Only failed tasks can be retried' });
      }

      // Check existing execution count instead of retryCount field
      const executionCount = await fastify.prisma.taskExecution.count({
        where: { taskId: id, task: { tenantId: request.user!.tenantId! } },
      });
      if (executionCount >= task.maxRetries) {
        return reply.status(400).send({ error: 'Max retries exceeded' });
      }

      const previousExecution = await fastify.prisma.taskExecution.findFirst({
        where: { taskId: id, task: { tenantId: request.user!.tenantId! } },
        orderBy: { attemptNumber: 'desc' },
      });

      // Reset existing task and create new execution record
      await fastify.prisma.$transaction([
        fastify.prisma.task.update({
          where: { id, tenantId: request.user!.tenantId! },
          data: {
            status: 'PENDING',
            nodeId: null,
          },
        }),
        fastify.prisma.taskExecution.create({
          data: {
            taskId: id,
            status: 'PENDING',
            attemptNumber: executionCount + 1,
            tenantId: request.user!.tenantId!,
            retryOf: previousExecution?.id ?? null,
          },
        }),
      ]);

      const updatedTask = await fastify.prisma.task.findUnique({
        where: { id, tenantId: request.user!.tenantId! },
        include: {
          node: { select: { id: true, name: true, region: true } },
          executions: { orderBy: { attemptNumber: 'desc' }, take: 1 },
        },
      });

      await fastify.taskScheduler.enqueue(updatedTask as any);
      fastify.wsManager.broadcast('task:created', updatedTask);

      return reply.status(201).send(updatedTask);
    },
  );

  // Get task logs
  fastify.get<{
    Params: { id: string };
    Querystring: { level?: string; limit?: number };
  }>(
    '/:id/logs',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        querystring: {
          type: 'object',
          properties: {
            level: { type: 'string' },
            limit: { type: 'number', default: 100 },
          },
        },
        tags: ['tasks'],
        summary: 'Get task logs',
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Querystring: { level?: string; limit?: number } }>, _reply) => {
      const { id } = request.params;
      const { level, limit = 100 } = request.query;

      const logs = await fastify.prisma.taskLog.findMany({
        where: {
          taskId: id,
          task: { tenantId: request.user!.tenantId! },
          ...(level && { level: level as any }),
        },
        orderBy: { timestamp: 'desc' },
        take: limit,
      });

      return logs;
    },
  );

  // Task statistics (DEMO: Deprecated in V1)
  fastify.get(
    '/stats',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['tasks'],
        summary: 'Get task statistics (Deprecated)',
      },
    },
    deprecated(
      { 
        deprecationDate: '2026-04-14', 
        sunsetDate: '2026-10-14', 
        link: 'https://docs.edgecloud.com/api/v2/stats' 
      },
      async (request, _reply) => {
        const tenantId = request.user!.tenantId!;
        const stats = await fastify.prisma.task.groupBy({
        where: { tenantId },
        by: ['status'],
        _count: true,
      });

      const byPriority = await fastify.prisma.task.groupBy({
        where: { tenantId },
        by: ['priority'],
        _count: true,
      });

      const byType = await fastify.prisma.task.groupBy({
        where: { tenantId },
        by: ['type'],
        _count: true,
      });

      return {
        byStatus: stats.reduce(
          (acc, s) => ({ ...acc, [s.status]: s._count }),
          {},
        ),
        byPriority: byPriority.reduce(
          (acc, p) => ({ ...acc, [p.priority]: p._count }),
          {},
        ),
        byType: byType.reduce((acc, t) => ({ ...acc, [t.type]: t._count }), {}),
      };
    })
  );
}


