import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { createTaskSchema, updateTaskSchema, taskQuerySchema, idParamSchema } from '../schemas'
import { zodToFastifySchema } from '../utils/zod-schema'

type TaskStatusStr = 'PENDING' | 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

export default async function taskRoutes(fastify: FastifyInstance) {
  // List tasks
  fastify.get('/', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: zodToFastifySchema(taskQuerySchema),
      tags: ['tasks'],
      summary: 'List tasks',
    },
  }, async (request: FastifyRequest<{ Querystring: z.infer<typeof taskQuerySchema> }>, reply: FastifyReply) => {
    const { status, type, nodeId, priority, page, limit, sortBy, sortOrder, from, to } = request.query

    const where: any = {
      ...(status && { status: status as TaskStatusStr }),
      ...(type && { type }),
      ...(nodeId && { nodeId }),
      ...(priority && { priority }),
      ...(from || to ? {
        submittedAt: {
          ...(from && { gte: new Date(from) }),
          ...(to && { lte: new Date(to) }),
        },
      } : {}),
    }

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
    ])

    return {
      data: tasks,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  })

  // Get task by ID
  fastify.get('/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      params: zodToFastifySchema(idParamSchema),
      tags: ['tasks'],
      summary: 'Get task by ID',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const task = await fastify.prisma.task.findUnique({
      where: { id: request.params.id },
      include: {
        node: true,
        logs: {
          orderBy: { timestamp: 'desc' },
          take: 100,
        },
      },
    })

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' })
    }

    return task
  })

  // Create task
  fastify.post('/', {
    preHandler: [fastify.authenticate],
    schema: {
      body: zodToFastifySchema(createTaskSchema),
      tags: ['tasks'],
      summary: 'Submit a new task',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof createTaskSchema> }>, reply: FastifyReply) => {
    const data = request.body

    // If nodeId specified, verify node is available
    if (data.nodeId) {
      const node = await fastify.prisma.edgeNode.findUnique({
        where: { id: data.nodeId },
      })

      if (!node || node.status !== 'ONLINE' || node.isMaintenanceMode) {
        return reply.status(400).send({ error: 'Node not available' })
      }
    }

    const task = await fastify.prisma.task.create({
      data: {
        name: data.name,
        type: data.type,
        priority: data.priority as any,
        target: data.target as any,
        nodeId: data.nodeId,
        policy: 'manual',
        reason: 'Manually submitted',
        input: (data.input || {}) as any,
        metadata: (data.metadata || {}) as any,
        maxRetries: data.maxRetries,
      },
      include: {
        node: {
          select: { id: true, name: true, region: true },
        },
      },
    })

    // Add to task queue
    await fastify.taskScheduler.enqueue(task as any)

    // Audit log
    await fastify.prisma.auditLog.create({
      data: {
        userId: request.user!.id,
        action: 'task.created',
        entityType: 'task',
        entityId: task.id,
        details: { name: task.name, type: task.type },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      },
    })

    // Broadcast via WebSocket
    fastify.wsManager.broadcast('task:created', task)

    return reply.status(201).send(task)
  })

  // Cancel task
  fastify.post('/:id/cancel', {
    preHandler: [fastify.authenticate],
    schema: {
      params: zodToFastifySchema(idParamSchema),
      tags: ['tasks'],
      summary: 'Cancel a task',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params

    const task = await fastify.prisma.task.findUnique({ where: { id } })

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' })
    }

    if (!['PENDING', 'SCHEDULED', 'RUNNING'].includes(task.status)) {
      return reply.status(400).send({ error: 'Task cannot be cancelled' })
    }

    const updated = await fastify.prisma.task.update({
      where: { id },
      data: {
        status: 'CANCELLED' as TaskStatusStr,
      },
    })

    // Broadcast via WebSocket
    fastify.wsManager.broadcast('task:cancelled', updated)

    return updated
  })

  // Retry task
  fastify.post('/:id/retry', {
    preHandler: [fastify.authenticate],
    schema: {
      params: zodToFastifySchema(idParamSchema),
      tags: ['tasks'],
      summary: 'Retry a failed task',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params

    const task = await fastify.prisma.task.findUnique({ where: { id } })

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' })
    }

    if (task.status !== 'FAILED') {
      return reply.status(400).send({ error: 'Only failed tasks can be retried' })
    }

    // Check existing execution count instead of retryCount field
    const executionCount = await fastify.prisma.taskExecution.count({ where: { taskId: id } })
    if (executionCount >= task.maxRetries) {
      return reply.status(400).send({ error: 'Max retries exceeded' })
    }

    const newTask = await fastify.prisma.task.create({
      data: {
        name: task.name,
        type: task.type,
        priority: task.priority,
        target: task.target,
        policy: task.policy,
        reason: `Retry of task ${task.id}`,
        input: task.input as any,
        metadata: ({ ...task.metadata as object, retryOf: task.id }) as any,
        maxRetries: task.maxRetries,
      },
    })

    await fastify.taskScheduler.enqueue(newTask as any)
    fastify.wsManager.broadcast('task:created', newTask)

    return reply.status(201).send(newTask)
  })

  // Get task logs
  fastify.get('/:id/logs', {
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
  }, async (request: FastifyRequest<{ Params: { id: string }; Querystring: { level?: string; limit?: number } }>, reply: FastifyReply) => {
    const { id } = request.params
    const { level, limit = 100 } = request.query

    const logs = await fastify.prisma.taskLog.findMany({
      where: {
        taskId: id,
        ...(level && { level: level as any }),
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    })

    return logs
  })

  // Task statistics
  fastify.get('/stats', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['tasks'],
      summary: 'Get task statistics',
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const stats = await fastify.prisma.task.groupBy({
      by: ['status'],
      _count: true,
    })

    const byPriority = await fastify.prisma.task.groupBy({
      by: ['priority'],
      _count: true,
    })

    const byType = await fastify.prisma.task.groupBy({
      by: ['type'],
      _count: true,
    })

    return {
      byStatus: stats.reduce((acc, s) => ({ ...acc, [s.status]: s._count }), {}),
      byPriority: byPriority.reduce((acc, p) => ({ ...acc, [p.priority]: p._count }), {}),
      byType: byType.reduce((acc, t) => ({ ...acc, [t.type]: t._count }), {}),
    }
  })
}
