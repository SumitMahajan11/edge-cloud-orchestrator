// ============================================================================
// Task Orchestration REST API Specification
// ============================================================================
// 
// Complete API lifecycle for task management in an edge-cloud orchestration platform.
// Base URL: /api/v1/tasks
// ============================================================================

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  createTaskSchema,
  taskQuerySchema,
  idParamSchema,
} from '../schemas'
import { zodToFastifySchema } from '../utils/zod-schema'

// ============================================================================
// Schema Definitions
// ============================================================================

const taskLogsQuerySchema = z.object({
  level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional(),
  executionId: z.string().uuid().optional(),
  source: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

const taskHistoryQuerySchema = z.object({
  includeExecutions: z.coerce.boolean().default(true),
  includeLogs: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(10),
})

const cancelTaskSchema = z.object({
  reason: z.string().max(500).optional(),
  force: z.boolean().default(false), // Force kill running container
})

const retryTaskSchema = z.object({
  nodeId: z.string().uuid().optional(), // Override node assignment
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  input: z.record(z.unknown()).optional(), // Override input
})

// Type exports
type TaskLogsQuery = z.infer<typeof taskLogsQuerySchema>
type TaskHistoryQuery = z.infer<typeof taskHistoryQuerySchema>
type CancelTaskBody = z.infer<typeof cancelTaskSchema>
type RetryTaskBody = z.infer<typeof retryTaskSchema>

// ============================================================================
// Response Type Interfaces
// ============================================================================

interface TaskResponse {
  id: string
  name: string
  type: string
  status: string
  priority: string
  target: string
  nodeId: string | null
  node: { id: string; name: string; region: string } | null
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  metadata: Record<string, unknown>
  maxRetries: number
  retryCount: number
  submittedAt: string
  startedAt: string | null
  completedAt: string | null
  duration: number | null
}

interface TaskExecutionResponse {
  id: string
  taskId: string
  attemptNumber: number
  nodeId: string | null
  nodeUrl: string | null
  status: string
  exitCode: number | null
  scheduledAt: string
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  queueWaitMs: number | null
  cpuUsageAvg: number | null
  memoryUsageMax: number | null
  costUSD: number | null
  containerId: string | null
  image: string | null
  output: Record<string, unknown> | null
  error: string | null
}

interface TaskHistoryResponse {
  task: TaskResponse
  executions: TaskExecutionResponse[]
  totalExecutions: number
  totalDurationMs: number
  totalCostUSD: number
  timeline: Array<{
    timestamp: string
    event: string
    details: Record<string, unknown>
  }>
}

// ============================================================================
// Route Implementation
// ============================================================================

export default async function taskLifecycleRoutes(fastify: FastifyInstance) {
  // ==========================================================================
  // 1. CREATE - Submit a new task
  // ==========================================================================
  /**
   * POST /api/v1/tasks
   * 
   * Creates a new task and adds it to the scheduling queue.
   * 
   * Request Body:
   * {
   *   "name": "Image classification batch #1234",
   *   "type": "IMAGE_CLASSIFICATION",
   *   "priority": "HIGH",
   *   "target": "EDGE",
   *   "nodeId": "uuid", (optional - auto-assign if omitted)
   *   "input": { "imageUrl": "s3://bucket/images/", "batchSize": 100 },
   *   "metadata": { "projectId": "proj-123", "customer": "acme" },
   *   "maxRetries": 3
   * }
   * 
   * Response 201:
   * {
   *   "id": "550e8400-e29b-41d4-a716-446655440000",
   *   "name": "Image classification batch #1234",
   *   "type": "IMAGE_CLASSIFICATION",
   *   "status": "PENDING",
   *   "priority": "HIGH",
   *   "target": "EDGE",
   *   "nodeId": null,
   *   "node": null,
   *   "input": { "imageUrl": "s3://bucket/images/", "batchSize": 100 },
   *   "output": null,
   *   "metadata": { "projectId": "proj-123", "customer": "acme" },
   *   "maxRetries": 3,
   *   "retryCount": 0,
   *   "submittedAt": "2024-03-15T10:30:00Z",
   *   "startedAt": null,
   *   "completedAt": null,
   *   "duration": null,
   *   "_links": {
   *     "self": { "href": "/api/v1/tasks/550e8400-e29b-41d4-a716-446655440000" },
   *     "logs": { "href": "/api/v1/tasks/550e8400-e29b-41d4-a716-446655440000/logs" },
   *     "cancel": { "href": "/api/v1/tasks/550e8400-e29b-41d4-a716-446655440000/cancel", "method": "POST" },
   *     "history": { "href": "/api/v1/tasks/550e8400-e29b-41d4-a716-446655440000/history" }
   *   }
   * }
   */
  fastify.post<{
    Body: z.infer<typeof createTaskSchema>
  }>('/', {
    preHandler: [fastify.authenticate],
    schema: {
      body: zodToFastifySchema(createTaskSchema),
      tags: ['tasks'],
      summary: 'Create a new task',
      description: 'Submits a new task to the orchestration queue',
    },
  }, async (request, reply) => {
    const data = request.body
    
    // Validate node if specified
    if (data.nodeId) {
      const node = await fastify.prisma.edgeNode.findUnique({
        where: { id: data.nodeId },
      })
      if (!node || node.status !== 'ONLINE' || node.isMaintenanceMode) {
        return reply.status(400).send({
          error: 'Node not available',
          code: 'NODE_UNAVAILABLE',
        })
      }
    }
    
    // Create task with initial execution record
    const task = await fastify.prisma.task.create({
      data: {
        name: data.name,
        type: data.type,
        priority: data.priority,
        target: data.target,
        nodeId: data.nodeId,
        policy: data.nodeId ? 'manual' : 'auto',
        reason: 'User submitted',
        input: (data.input ?? {}) as any,
        metadata: (data.metadata ?? {}) as any,
        maxRetries: data.maxRetries ?? 3,
        executions: {
          create: {
            status: 'PENDING',
            attemptNumber: 1,
          },
        },
      },
      include: {
        node: { select: { id: true, name: true, region: true } },
        executions: { orderBy: { scheduledAt: 'desc' }, take: 1 },
      },
    })
    
    // Enqueue for scheduling
    await fastify.taskScheduler.enqueue(task as any)
    
    // Audit log
    await fastify.prisma.auditLog.create({
      data: {
        userId: request.user.id,
        action: 'task.created',
        entityType: 'task',
        entityId: task.id,
        details: { name: task.name, type: task.type, priority: task.priority },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      },
    })
    
    // Broadcast
    fastify.wsManager.broadcast('task:created', task)
    
    // Build HATEOAS links
    const taskWithLinks = {
      ...task,
      _links: buildTaskLinks(task.id),
    }
    
    return reply.status(201).send(taskWithLinks)
  })

  // ==========================================================================
  // 2. VIEW - List tasks
  // ==========================================================================
  /**
   * GET /api/v1/tasks
   * 
   * Query Parameters:
   * - status: PENDING | SCHEDULED | RUNNING | COMPLETED | FAILED | CANCELLED
   * - type: Task type filter
   * - nodeId: Filter by assigned node
   * - priority: CRITICAL | HIGH | MEDIUM | LOW
   * - page: Page number (default: 1)
   * - limit: Items per page (default: 20, max: 100)
   * - sortBy: submittedAt | priority | status | duration
   * - sortOrder: asc | desc
   * - from: ISO datetime for submittedAt filter
   * - to: ISO datetime for submittedAt filter
   * 
   * Response 200:
   * ```json
   * {
   *   "data": [],
   *   "pagination": {
   *     "page": 1,
   *     "limit": 20,
   *     "total": 145,
   *     "totalPages": 8
   *   },
   *   "_links": {
   *     "self": { "href": "/api/v1/tasks?page=1&limit=20" },
   *     "next": { "href": "/api/v1/tasks?page=2&limit=20" },
   *     "last": { "href": "/api/v1/tasks?page=8&limit=20" }
   *   }
   * }
   * ```
   */
  fastify.get<{
    Querystring: z.infer<typeof taskQuerySchema>
  }>('/', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: zodToFastifySchema(taskQuerySchema),
      tags: ['tasks'],
      summary: 'List tasks',
    },
  }, async (request, reply) => {
    const { status, type, nodeId, priority, page, limit, sortBy, sortOrder, from, to } = request.query
    
    const where: any = {
      ...(status && { status }),
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
          node: { select: { id: true, name: true, region: true } },
          executions: {
            where: { status: 'RUNNING' },
            take: 1,
          },
        },
      }),
      fastify.prisma.task.count({ where }),
    ])
    
    const totalPages = Math.ceil(total / limit)
    
    return {
      data: tasks.map(t => ({ ...t, _links: buildTaskLinks(t.id) })),
      pagination: { page, limit, total, totalPages },
      _links: {
        self: { href: `/api/v1/tasks?page=${page}&limit=${limit}` },
        ...(page < totalPages && { next: { href: `/api/v1/tasks?page=${page + 1}&limit=${limit}` } }),
        ...(page > 1 && { prev: { href: `/api/v1/tasks?page=${page - 1}&limit=${limit}` } }),
        last: { href: `/api/v1/tasks?page=${totalPages}&limit=${limit}` },
      },
    }
  })

  // ==========================================================================
  // 3. VIEW - Get single task
  // ==========================================================================
  /**
   * GET /api/v1/tasks/:id
   * 
   * Response 200:
   * {
   *   "id": "550e8400-e29b-41d4-a716-446655440000",
   *   "name": "Image classification batch #1234",
   *   "type": "IMAGE_CLASSIFICATION",
   *   "status": "RUNNING",
   *   "priority": "HIGH",
   *   "target": "EDGE",
   *   "nodeId": "node-uuid",
   *   "node": { "id": "node-uuid", "name": "edge-node-1", "region": "us-east-1" },
   *   "input": { ... },
   *   "output": null,
   *   "metadata": { ... },
   *   "maxRetries": 3,
   *   "retryCount": 0,
   *   "submittedAt": "2024-03-15T10:30:00Z",
   *   "startedAt": "2024-03-15T10:30:05Z",
   *   "completedAt": null,
   *   "duration": null,
   *   "currentExecution": {
   *     "id": "exec-uuid",
   *     "attemptNumber": 1,
   *     "status": "RUNNING",
   *     "containerId": "container-123",
   *     "startedAt": "2024-03-15T10:30:05Z",
   *     "durationMs": 45000,
   *     "cpuUsageAvg": 0.72,
   *     "memoryUsageMax": 2.5
   *   },
   *   "_links": { ... }
   * }
   * 
   * Response 404:
   * {
   *   "error": "Task not found",
   *   "code": "TASK_NOT_FOUND",
   *   "taskId": "550e8400-e29b-41d4-a716-446655440000"
   * }
   */
  fastify.get<{
    Params: { id: string }
  }>('/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      params: zodToFastifySchema(idParamSchema),
      tags: ['tasks'],
      summary: 'Get task by ID',
    },
  }, async (request, reply) => {
    const { id } = request.params
    
    const task = await fastify.prisma.task.findUnique({
      where: { id },
      include: {
        node: { select: { id: true, name: true, region: true, status: true } },
        executions: {
          orderBy: { scheduledAt: 'desc' },
          take: 1,
        },
      },
    })
    
    if (!task) {
      return reply.status(404).send({
        error: 'Task not found',
        code: 'TASK_NOT_FOUND',
        taskId: id,
      })
    }
    
    // Get latest execution for running tasks
    const currentExecution = task.executions[0]
    
    return {
      ...task,
      currentExecution: currentExecution?.status === 'RUNNING' ? currentExecution : null,
      _links: buildTaskLinks(task.id),
    }
  })

  // ==========================================================================
  // 4. CANCEL - Cancel a task
  // ==========================================================================
  /**
   * POST /api/v1/tasks/:id/cancel
   * 
   * Request Body (optional):
   * {
   *   "reason": "User requested cancellation",
   *   "force": false
   * }
   * 
   * Response 200:
   * {
   *   "id": "550e8400-e29b-41d4-a716-446655440000",
   *   "status": "CANCELLED",
   *   "cancelledAt": "2024-03-15T10:35:00Z",
   *   "reason": "User requested cancellation",
   *   "previousStatus": "RUNNING",
   *   "execution": {
   *     "id": "exec-uuid",
   *     "status": "CANCELLED",
   *     "exitCode": 137,
   *     "durationMs": 300000,
   *     "costUSD": 0.05
   *   },
   *   "_links": { ... }
   * }
   * 
   * Response 400 (Invalid state):
   * {
   *   "error": "Task cannot be cancelled",
   *   "code": "INVALID_STATE_TRANSITION",
   *   "currentStatus": "COMPLETED",
   *   "allowedTransitions": []
   * }
   */
  fastify.post<{
    Params: { id: string }
    Body: CancelTaskBody
  }>('/:id/cancel', {
    preHandler: [fastify.authenticate],
    schema: {
      params: zodToFastifySchema(idParamSchema),
      body: zodToFastifySchema(cancelTaskSchema),
      tags: ['tasks'],
      summary: 'Cancel a task',
      description: 'Cancels a pending, scheduled, or running task',
    },
  }, async (request, reply) => {
    const { id } = request.params
    const { reason, force } = request.body ?? {}
    
    const task = await fastify.prisma.task.findUnique({
      where: { id },
      include: {
        executions: {
          where: { status: { in: ['PENDING', 'SCHEDULED', 'RUNNING'] } },
          take: 1,
        },
      },
    })
    
    if (!task) {
      return reply.status(404).send({
        error: 'Task not found',
        code: 'TASK_NOT_FOUND',
      })
    }
    
    const cancellableStates = ['PENDING', 'SCHEDULED', 'RUNNING']
    if (!cancellableStates.includes(task.status)) {
      return reply.status(400).send({
        error: 'Task cannot be cancelled',
        code: 'INVALID_STATE_TRANSITION',
        currentStatus: task.status,
        allowedTransitions: [],
      })
    }
    
    const previousStatus = task.status
    
    // Update task and execution
    const [updatedTask, updatedExecution] = await fastify.prisma.$transaction([
      fastify.prisma.task.update({
        where: { id },
        data: {
          status: 'CANCELLED',
        },
      }),
      task.executions[0] ? fastify.prisma.taskExecution.update({
        where: { id: task.executions[0].id },
        data: {
          status: 'CANCELLED',
          completedAt: new Date(),
          error: reason ?? 'Cancelled by user',
        },
      }) : null,
    ])
    
    // If running, send kill command to edge agent
    if (previousStatus === 'RUNNING' && task.nodeId) {
      try {
        const node = await fastify.prisma.edgeNode.findUnique({
          where: { id: task.nodeId },
        })
        
        if (node) {
          await fetch(`http://${node.ipAddress}:${node.port}/tasks/${task.id}/kill`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force, reason }),
          })
        }
      } catch (err) {
        request.log.warn({ err, taskId: id }, 'Failed to send kill command to node')
      }
    }
    
    // Remove from queue if pending
    if (previousStatus === 'PENDING') {
      await fastify.taskScheduler.dequeue(id)
    }
    
    // Audit log
    await fastify.prisma.auditLog.create({
      data: {
        userId: request.user.id,
        action: 'task.cancelled',
        entityType: 'task',
        entityId: id,
        details: { reason, previousStatus, force },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      },
    })
    
    // Broadcast
    fastify.wsManager.broadcast('task:cancelled', { id, reason, previousStatus })
    
    return {
      ...updatedTask,
      cancelledAt: updatedExecution?.completedAt ?? new Date(),
      reason,
      previousStatus,
      execution: updatedExecution,
      _links: buildTaskLinks(id),
    }
  })

  // ==========================================================================
  // 5. RETRY - Retry a failed task
  // ==========================================================================
  /**
   * POST /api/v1/tasks/:id/retry
   * 
   * Request Body (optional):
   * {
   *   "nodeId": "different-node-uuid",
   *   "priority": "CRITICAL",
   *   "input": { "overrideField": "newValue" }
   * }
   * 
   * Response 201:
   * {
   *   "id": "new-task-uuid",
   *   "retryOf": "550e8400-e29b-41d4-a716-446655440000",
   *   "attemptNumber": 2,
   *   "name": "Image classification batch #1234 (retry #1)",
   *   "status": "PENDING",
   *   "previousExecution": {
   *     "id": "exec-uuid",
   *     "status": "FAILED",
   *     "exitCode": 1,
   *     "error": "OutOfMemoryError",
   *     "durationMs": 45000
   *   },
   *   "_links": { ... }
   * }
   * 
   * Response 400 (Not retryable):
   * {
   *   "error": "Task cannot be retried",
   *   "code": "NOT_RETRYABLE",
   *   "currentStatus": "RUNNING",
   *   "retryableStates": ["FAILED", "CANCELLED", "TIMEOUT"]
   * }
   * 
   * Response 400 (Max retries):
   * {
   *   "error": "Maximum retries exceeded",
   *   "code": "MAX_RETRIES_EXCEEDED",
   *   "retryCount": 3,
   *   "maxRetries": 3
   * }
   */
  fastify.post<{
    Params: { id: string }
    Body: RetryTaskBody
  }>('/:id/retry', {
    preHandler: [fastify.authenticate],
    schema: {
      params: zodToFastifySchema(idParamSchema),
      body: zodToFastifySchema(retryTaskSchema),
      tags: ['tasks'],
      summary: 'Retry a failed task',
      description: 'Creates a new task as a retry of a failed, cancelled, or timed out task',
    },
  }, async (request, reply) => {
    const { id } = request.params
    const overrides = request.body ?? {}
    
    const originalTask = await fastify.prisma.task.findUnique({
      where: { id },
      include: {
        executions: {
          orderBy: { attemptNumber: 'desc' },
          take: 1,
        },
      },
    })
    
    if (!originalTask) {
      return reply.status(404).send({
        error: 'Task not found',
        code: 'TASK_NOT_FOUND',
      })
    }
    
    const retryableStates = ['FAILED', 'CANCELLED', 'TIMEOUT']
    if (!retryableStates.includes(originalTask.status)) {
      return reply.status(400).send({
        error: 'Task cannot be retried',
        code: 'NOT_RETRYABLE',
        currentStatus: originalTask.status,
        retryableStates,
      })
    }
    
    // Check retry count across all attempts
    const allExecutions = await fastify.prisma.taskExecution.count({
      where: { taskId: id },
    })
    
    if (allExecutions >= originalTask.maxRetries) {
      return reply.status(400).send({
        error: 'Maximum retries exceeded',
        code: 'MAX_RETRIES_EXCEEDED',
        retryCount: allExecutions,
        maxRetries: originalTask.maxRetries,
      })
    }
    
    const previousExecution = originalTask.executions[0]
    
    // Create new task (clone)
    const newTask = await fastify.prisma.task.create({
      data: {
        name: `${originalTask.name} (retry #${allExecutions})`,
        type: originalTask.type,
        priority: overrides.priority ?? originalTask.priority,
        target: originalTask.target,
        nodeId: overrides.nodeId ?? null,
        policy: overrides.nodeId ? 'manual' : 'auto',
        reason: `Retry of task ${id}`,
        input: (overrides.input ?? originalTask.input) as any,
        metadata: ({
          ...(originalTask.metadata as Record<string, unknown>),
          retryOf: id,
          retryAttempt: allExecutions + 1,
          originalSubmittedAt: originalTask.submittedAt,
        }) as any,
        maxRetries: originalTask.maxRetries,
        executions: {
          create: {
            status: 'PENDING',
            attemptNumber: allExecutions + 1,
          },
        },
      },
      include: {
        node: { select: { id: true, name: true, region: true } },
      },
    })
    
    // Enqueue for scheduling
    await fastify.taskScheduler.enqueue(newTask as any)
    
    // Audit log
    await fastify.prisma.auditLog.create({
      data: {
        userId: request.user.id,
        action: 'task.retried',
        entityType: 'task',
        entityId: newTask.id,
        details: ({
          originalTaskId: id,
          attemptNumber: allExecutions + 1,
          overrides,
        }) as any,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      },
    })
    
    // Broadcast
    fastify.wsManager.broadcast('task:created', newTask)
    
    return reply.status(201).send({
      ...newTask,
      retryOf: id,
      attemptNumber: allExecutions + 1,
      previousExecution: {
        id: previousExecution?.id,
        status: previousExecution?.status,
        exitCode: previousExecution?.exitCode,
        error: previousExecution?.error,
        durationMs: previousExecution?.durationMs,
      },
      _links: buildTaskLinks(newTask.id),
    })
  })

  // ==========================================================================
  // 6. LOGS - Get task logs
  // ==========================================================================
  /**
   * GET /api/v1/tasks/:id/logs
   * 
   * Query Parameters:
   * - level: DEBUG | INFO | WARN | ERROR
   * - executionId: Filter by specific execution
   * - source: Filter by log source (scheduler, agent, container)
   * - from: ISO datetime
   * - to: ISO datetime
   * - limit: Max logs to return (default: 100, max: 1000)
   * - offset: Pagination offset
   * 
   * Response 200:
   * {
   *   "taskId": "550e8400-e29b-41d4-a716-446655440000",
   *   "logs": [
   *     {
   *       "id": "log-uuid",
   *       "timestamp": "2024-03-15T10:30:05.123Z",
   *       "level": "INFO",
   *       "source": "container",
   *       "message": "Processing batch of 100 images",
   *       "metadata": { "batchSize": 100 }
   *     },
   *     {
   *       "id": "log-uuid-2",
   *       "timestamp": "2024-03-15T10:30:10.456Z",
   *       "level": "ERROR",
   *       "source": "container",
   *       "message": "OutOfMemoryError in image processor",
   *       "metadata": { "heapUsed": "4GB", "heapMax": "4GB" }
   *     }
   *   ],
   *   "pagination": {
   *     "limit": 100,
   *     "offset": 0,
   *     "total": 1523
   *   },
   *   "summary": {
   *     "byLevel": { "DEBUG": 500, "INFO": 800, "WARN": 200, "ERROR": 23 },
   *     "firstLog": "2024-03-15T10:30:00Z",
   *     "lastLog": "2024-03-15T10:35:00Z"
   *   },
   *   "_links": { ... }
   * }
   */
  fastify.get<{
    Params: { id: string }
    Querystring: TaskLogsQuery
  }>('/:id/logs', {
    preHandler: [fastify.authenticate],
    schema: {
      params: zodToFastifySchema(idParamSchema),
      querystring: zodToFastifySchema(taskLogsQuerySchema),
      tags: ['tasks'],
      summary: 'Get task logs',
    },
  }, async (request, reply) => {
    const { id } = request.params
    const { level, executionId, source, from, to, limit, offset } = request.query
    
    // Verify task exists
    const task = await fastify.prisma.task.findUnique({
      where: { id },
      select: { id: true },
    })
    
    if (!task) {
      return reply.status(404).send({
        error: 'Task not found',
        code: 'TASK_NOT_FOUND',
      })
    }
    
    const where: any = {
      taskId: id,
      ...(level && { level }),
      ...(executionId && { executionId }),
      ...(source && { source }),
      ...(from || to ? {
        timestamp: {
          ...(from && { gte: new Date(from) }),
          ...(to && { lte: new Date(to) }),
        },
      } : {}),
    }
    
    const [logs, total, levelCounts] = await Promise.all([
      fastify.prisma.taskLog.findMany({
        where,
        orderBy: { timestamp: 'asc' },
        skip: offset,
        take: limit,
      }),
      fastify.prisma.taskLog.count({ where }),
      fastify.prisma.taskLog.groupBy({
        by: ['level'],
        where: { taskId: id },
        _count: true,
      }),
    ])
    
    const firstLog = await fastify.prisma.taskLog.findFirst({
      where: { taskId: id },
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true },
    })
    
    const lastLog = await fastify.prisma.taskLog.findFirst({
      where: { taskId: id },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    })
    
    return {
      taskId: id,
      logs,
      pagination: { limit, offset, total },
      summary: {
        byLevel: levelCounts.reduce((acc, l) => ({ ...acc, [l.level]: l._count }), {}),
        firstLog: firstLog?.timestamp,
        lastLog: lastLog?.timestamp,
      },
      _links: buildTaskLinks(id),
    }
  })

  // ==========================================================================
  // 7. HISTORY - Get task execution history
  // ==========================================================================
  /**
   * GET /api/v1/tasks/:id/history
   * 
   * Query Parameters:
   * - includeExecutions: Include execution details (default: true)
   * - includeLogs: Include logs for each execution (default: false)
   * - limit: Max executions to return (default: 10)
   * 
   * Response 200:
   * ```json
   * {
   *   "task": {},
   *   "executions": [
   *     {
   *       "id": "exec-1",
   *       "attemptNumber": 1,
   *       "status": "FAILED"
   *     }
   *   ],
   *   "timeline": [
   *     { "timestamp": "2024-03-15T10:00:00Z", "event": "created" }
   *   ],
   *   "summary": {
   *     "totalExecutions": 2,
   *     "successRate": 0.5
   *   }
   * }
   * ```
   */
  fastify.get<{
    Params: { id: string }
    Querystring: TaskHistoryQuery
  }>('/:id/history', {
    preHandler: [fastify.authenticate],
    schema: {
      params: zodToFastifySchema(idParamSchema),
      querystring: zodToFastifySchema(taskHistoryQuerySchema),
      tags: ['tasks'],
      summary: 'Get task execution history',
      description: 'Returns complete execution history including all attempts',
    },
  }, async (request, reply) => {
    const { id } = request.params
    const { includeExecutions, includeLogs, limit } = request.query
    
    const task = await fastify.prisma.task.findUnique({
      where: { id },
      include: {
        node: { select: { id: true, name: true, region: true } },
        executions: {
          orderBy: { attemptNumber: 'desc' },
          take: limit,
          include: {
            node: { select: { id: true, name: true, region: true } },
            ...(includeLogs && {
              logs: {
                orderBy: { timestamp: 'asc' },
              },
            }),
          },
        },
      },
    })
    
    if (!task) {
      return reply.status(404).send({
        error: 'Task not found',
        code: 'TASK_NOT_FOUND',
      })
    }
    
    // Build timeline from logs
    const timelineLogs = await fastify.prisma.taskLog.findMany({
      where: {
        taskId: id,
        source: 'scheduler',
      },
      orderBy: { timestamp: 'asc' },
    })
    
    const timeline = [
      { timestamp: task.submittedAt, event: 'created', details: {} },
      ...timelineLogs.map(log => ({
        timestamp: log.timestamp,
        event: log.message.toLowerCase().replace(/\s+/g, '_'),
        details: (log.metadata as Record<string, unknown>) ?? {},
      })),
    ]
    
    // Calculate summary
    const executions = task.executions
    const completedExecutions = executions.filter(e => e.status === 'COMPLETED')
    const totalDuration = executions.reduce((sum, e) => sum + (e.durationMs ?? 0), 0)
    const totalCost = executions.reduce((sum, e) => sum + (e.costUSD ?? 0), 0)
    
    return {
      task: {
        id: task.id,
        name: task.name,
        type: task.type,
        status: task.status,
        priority: task.priority,
        target: task.target,
        node: task.node,
        input: task.input,
        metadata: task.metadata,
        maxRetries: task.maxRetries,
        submittedAt: task.submittedAt,
      },
      executions: includeExecutions ? executions : [],
      timeline,
      summary: {
        totalExecutions: executions.length,
        totalDurationMs: totalDuration,
        totalCostUSD: totalCost,
        successRate: executions.length > 0 ? completedExecutions.length / executions.length : 0,
        avgDurationMs: executions.length > 0 ? totalDuration / executions.length : 0,
      },
      _links: buildTaskLinks(id),
    }
  })

  // ==========================================================================
  // 8. STATS - Task statistics
  // ==========================================================================
  fastify.get('/stats', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['tasks'],
      summary: 'Get task statistics',
    },
  }, async (request, reply) => {
    const [
      byStatus,
      byPriority,
      byType,
      avgDuration,
      recentTasks,
      failureRate,
    ] = await Promise.all([
      fastify.prisma.task.groupBy({
        by: ['status'],
        _count: true,
      }),
      fastify.prisma.task.groupBy({
        by: ['priority'],
        _count: true,
      }),
      fastify.prisma.task.groupBy({
        by: ['type'],
        _count: true,
      }),
      fastify.prisma.taskExecution.aggregate({
        where: { status: 'COMPLETED' },
        _avg: { durationMs: true },
      }),
      fastify.prisma.task.count({
        where: {
          submittedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      fastify.prisma.taskExecution.aggregate({
        where: { status: { in: ['COMPLETED', 'FAILED'] } },
        _count: true,
        _avg: {
          durationMs: true,
        },
      }),
    ])
    
    return {
      byStatus: byStatus.reduce((acc, s) => ({ ...acc, [s.status]: s._count }), {}),
      byPriority: byPriority.reduce((acc, p) => ({ ...acc, [p.priority]: p._count }), {}),
      byType: byType.reduce((acc, t) => ({ ...acc, [t.type]: t._count }), {}),
      avgDurationMs: avgDuration._avg.durationMs ?? 0,
      recentTasks24h: recentTasks,
      queueDepth: byStatus.find(s => s.status === 'PENDING')?._count ?? 0,
      runningCount: byStatus.find(s => s.status === 'RUNNING')?._count ?? 0,
    }
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

function buildTaskLinks(taskId: string) {
  return {
    self: { href: `/api/v1/tasks/${taskId}` },
    logs: { href: `/api/v1/tasks/${taskId}/logs` },
    history: { href: `/api/v1/tasks/${taskId}/history` },
    cancel: { href: `/api/v1/tasks/${taskId}/cancel`, method: 'POST' },
    retry: { href: `/api/v1/tasks/${taskId}/retry`, method: 'POST' },
  }
}
