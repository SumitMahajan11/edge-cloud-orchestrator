// ============================================================================
// Task Orchestration REST API Specification
// ============================================================================
//
// Complete API lifecycle for task management in an edge-cloud orchestration platform.
// Base URL: /api/v1/tasks
// ============================================================================

import { Permissions } from '@edgecloud/shared-kernel';
import type { FastifyInstance } from 'fastify';
import { Prisma, TaskStatus, TaskType } from '@prisma/client';
import { z } from 'zod';

import { createTaskSchema, idParamSchema, taskQuerySchema } from '../schemas';
import { zodToFastifySchema } from '../utils/zod-schema';
import type { TenantId } from '../types/fastify.js';

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
});

const taskHistoryQuerySchema = z.object({
  includeExecutions: z.coerce.boolean().default(true),
  includeLogs: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

const cancelTaskSchema = z.object({
  reason: z.string().max(500).optional(),
  force: z.boolean().default(false), // Force kill running container
});

const retryTaskSchema = z.object({
  nodeId: z.string().uuid().optional(), // Override node assignment
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  input: z.record(z.unknown()).optional(), // Override input
});

// Type aliases for route validation (Note: Using 'any' in handlers for now to satisfy complex Fastify/Zod constraints)

// ============================================================================
// Response Type Interfaces
// ============================================================================

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
  fastify.post(
    '/',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_CREATE),
      ],
      schema: {
        body: zodToFastifySchema(createTaskSchema),
        tags: ['tasks'],
        summary: 'Create a new task',
        description: 'Submits a new task to the orchestration queue',
      },
    },
    async (request, reply) => {
      const data = request.body as z.infer<typeof createTaskSchema>;

      // Validate node if specified
      if (data.nodeId) {
        const node = await request.tPrisma.edgeNode.findUnique({
          where: { id: data.nodeId },
        });
        if (!node || node.status !== 'ONLINE' || node.isMaintenanceMode) {
          return reply.status(400).send({
            error: {
              code: 'NODE_UNAVAILABLE',
              message: 'Node not available',
              requestId: request.id,
            },
          });
        }
      }

      // Create task with initial execution record
      const task = await request.tPrisma.task.create({
        data: {
          name: data.name,
          type: data.type as TaskType,
          priority: data.priority,
          target: data.target,
          nodeId: data.nodeId ?? null,
          tenantId: request.user!.tenantId!,
          policy: data.policy ?? (data.nodeId ? 'manual' : 'auto'),
          isDeferrable: data.isDeferrable ?? false,
          maxDelayMinutes: data.maxDelayMinutes ?? 0,
          reason: 'User submitted',
          input: (data.input ?? {}) as Prisma.InputJsonValue,
          metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
          maxRetries: data.maxRetries ?? 3,
          executions: {
            create: {
              status: 'PENDING',
              attemptNumber: 1,
              tenantId: request.user!.tenantId!,
            },
          },
        },
        include: {
          node: { select: { id: true, name: true, region: true } },
          executions: { orderBy: { scheduledAt: 'desc' }, take: 1 },
        },
      });

      // Enqueue for scheduling
      await fastify.taskScheduler.enqueue(task);

      // Audit log
      await request.tPrisma.auditLog.create({
        data: {
          userId: request.user!.id,
          tenantId: request.user!.tenantId!,
          action: 'task.created',
          entityType: 'task',
          entityId: task.id,
          details: {
            name: task.name,
            type: task.type,
            priority: task.priority,
          },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
      });

      // Broadcast
      fastify.wsManager.broadcastToTenant(
        task.tenantId as TenantId,
        'task:created',
        task,
      );

      // Build HATEOAS links
      const taskWithLinks = {
        ...task,
        _links: buildTaskLinks(task.id),
      };

      return reply.status(201).send(taskWithLinks);
    },
  );

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
  fastify.get(
    '/',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_READ),
      ],
      schema: {
        querystring: zodToFastifySchema(taskQuerySchema),
        tags: ['tasks'],
        summary: 'List tasks',
      },
    },
    async (request) => {
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
      } = request.query as unknown as z.infer<typeof taskQuerySchema>;

      const where: Prisma.TaskWhereInput = {
        ...(status && { status: status as TaskStatus }),
        ...(type && { type: type as TaskType }),
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
        request.tPrisma.task.findMany({
          where,
          orderBy: { [sortBy ?? 'submittedAt']: sortOrder ?? 'desc' },
          skip: ((page ?? 1) - 1) * (limit ?? 20),
          take: limit ?? 20,
          include: {
            node: { select: { id: true, name: true, region: true } },
            executions: {
              where: { status: 'RUNNING' },
              take: 1,
            },
          },
        }),
        request.tPrisma.task.count({ where }),
      ]);

      const totalPages = Math.ceil(total / (limit ?? 20));

      return {
        data: tasks.map((t) => ({ ...t, _links: buildTaskLinks(t.id) })),
        pagination: { page: page ?? 1, limit: limit ?? 20, total, totalPages },
        _links: {
          self: { href: `/api/v1/tasks?page=${page ?? 1}&limit=${limit ?? 20}` },
          ...(page! < totalPages && {
            next: { href: `/api/v1/tasks?page=${(page ?? 1) + 1}&limit=${limit ?? 20}` },
          }),
          ...(page! > 1 && {
            prev: { href: `/api/v1/tasks?page=${(page ?? 1) - 1}&limit=${limit ?? 20}` },
          }),
          last: { href: `/api/v1/tasks?page=${totalPages}&limit=${limit ?? 20}` },
        },
      };
    },
  );

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
  fastify.get(
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
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const task = await request.tPrisma.task.findUnique({
        where: { id },
        include: {
          node: {
            select: { id: true, name: true, region: true, status: true },
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
            code: 'TASK_NOT_FOUND',
            message: 'Task not found',
            details: { taskId: id },
            requestId: request.id,
          },
        });
      }

      // Get latest execution for running tasks
      const currentExecution = task.executions[0];

      return {
        ...task,
        currentExecution:
          currentExecution?.status === 'RUNNING' ? currentExecution : null,
        _links: buildTaskLinks(task.id),
      };
    },
  );

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
  fastify.post(
    '/:id/cancel',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_CANCEL),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        body: zodToFastifySchema(cancelTaskSchema),
        tags: ['tasks'],
        summary: 'Cancel a task',
        description: 'Cancels a pending, scheduled, or running task',
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { reason, force } = (request.body ?? {}) as z.infer<typeof cancelTaskSchema>;

      const task = await request.tPrisma.task.findUnique({
        where: { id },
        include: {
          executions: {
            where: { status: { in: ['PENDING', 'SCHEDULED', 'RUNNING'] } },
            take: 1,
          },
        },
      });

      if (!task) {
        return reply.status(404).send({
          error: {
            code: 'TASK_NOT_FOUND',
            message: 'Task not found',
            requestId: request.id,
          },
        });
      }

      const cancellableStates = ['PENDING', 'SCHEDULED', 'RUNNING'];
      if (!cancellableStates.includes(task.status)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_STATE_TRANSITION',
            message: 'Task cannot be cancelled',
            details: {
              currentStatus: task.status,
              allowedTransitions: [],
            },
            requestId: request.id,
          },
        });
      }

      const previousStatus = task.status;

      // Update task and execution
      const operations: any[] = [
        request.tPrisma.task.update({
          where: { id },
          data: {
            status: 'CANCELLED',
          },
        }),
      ];

      if (task.executions[0]) {
        operations.push(
          request.tPrisma.taskExecution.update({
            where: { id: task.executions[0].id },
            data: {
              status: 'CANCELLED',
              completedAt: new Date(),
              error: reason ?? 'Cancelled by user',
            },
          }),
        );
      }

      const results = await request.tPrisma.$transaction(operations);
      const updatedTask = results[0];
      const updatedExecution = results[1] ?? null;

      // Decrement rate limiter pending count if scheduled or running
      if (
        ['SCHEDULED', 'RUNNING'].includes(previousStatus) &&
        task.nodeId &&
        fastify.taskScheduler?.schedulerRateLimiter
      ) {
        await fastify.taskScheduler.schedulerRateLimiter.recordTaskCompleted(task.nodeId);
      }

      // If running, send kill command to edge agent
      if (previousStatus === 'RUNNING' && task.nodeId) {
        try {
          const node = await request.tPrisma.edgeNode.findUnique({
            where: { id: task.nodeId },
          });

          if (node) {
            await fetch(
              `http://${node.ipAddress}:${node.port}/tasks/${task.id}/kill`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force, reason }),
              },
            );
          }
        } catch (err) {
          request.log.warn(
            { err, taskId: id },
            'Failed to send kill command to node',
          );
        }
      }

      // Remove from queue if pending
      if (previousStatus === 'PENDING') {
        await fastify.taskScheduler.dequeue(id);
      }

      // Audit log
      await request.tPrisma.auditLog.create({
        data: {
          userId: request.user!.id,
          tenantId: request.user!.tenantId!,
          action: 'task.cancelled',
          entityType: 'task',
          entityId: id,
          details: { reason, previousStatus, force } as Prisma.InputJsonValue,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
      });

      // Broadcast
      fastify.wsManager.broadcastToTenant(
        task.tenantId as TenantId,
        'task:cancelled',
        {
          id,
          reason,
          previousStatus,
        },
      );

      return {
        ...updatedTask,
        cancelledAt: updatedExecution?.completedAt ?? new Date(),
        reason,
        previousStatus,
        execution: updatedExecution,
        _links: buildTaskLinks(id),
      };
    },
  );

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
  fastify.post(
    '/:id/retry',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_ADMIN),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        body: zodToFastifySchema(retryTaskSchema),
        tags: ['tasks'],
        summary: 'Retry a failed task',
        description:
          'Creates a new task as a retry of a failed, cancelled, or timed out task',
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const overrides = (request.body ?? {}) as z.infer<typeof retryTaskSchema>;

      const originalTask = await request.tPrisma.task.findUnique({
        where: { id },
        include: {
          executions: {
            orderBy: { attemptNumber: 'desc' },
            take: 1,
          },
        },
      });

      if (!originalTask) {
        return reply.status(404).send({
          error: {
            code: 'TASK_NOT_FOUND',
            message: 'Task not found',
            requestId: request.id,
          },
        });
      }

      const retryableStates = ['FAILED', 'CANCELLED', 'TIMEOUT'];
      if (!retryableStates.includes(originalTask.status)) {
        return reply.status(400).send({
          error: {
            code: 'NOT_RETRYABLE',
            message: 'Task cannot be retried',
            details: {
              currentStatus: originalTask.status,
              retryableStates,
            },
            requestId: request.id,
          },
        });
      }

      // Check retry count across all attempts
      const allExecutions = await request.tPrisma.taskExecution.count({
        where: { taskId: id },
      });

      if (allExecutions >= originalTask.maxRetries) {
        return reply.status(400).send({
          error: {
            code: 'MAX_RETRIES_EXCEEDED',
            message: 'Maximum retries exceeded',
            details: {
              retryCount: allExecutions,
              maxRetries: originalTask.maxRetries,
            },
            requestId: request.id,
          },
        });
      }

      const previousExecution = originalTask.executions[0];

      // Reset existing task and create new execution record
      await request.tPrisma.$transaction([
        request.tPrisma.task.update({
          where: { id },
          data: {
            status: 'PENDING',
            nodeId: overrides.nodeId ?? null,
            priority: overrides.priority ?? originalTask.priority,
            input: (overrides.input ?? originalTask.input) as Prisma.InputJsonValue,
          },
        }),
        request.tPrisma.taskExecution.create({
          data: {
            taskId: id,
            status: 'PENDING',
            attemptNumber: allExecutions + 1,
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

      // Enqueue for scheduling
      if (updatedTask) {
        await fastify.taskScheduler.enqueue(updatedTask);
      }

      // Audit log
      await request.tPrisma.auditLog.create({
        data: {
          userId: request.user!.id,
          tenantId: request.user!.tenantId!,
          action: 'task.retried',
          entityType: 'task',
          entityId: id,
          details: {
            attemptNumber: allExecutions + 1,
            overrides,
          } as Prisma.InputJsonValue,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
      });

      // Broadcast
      if (updatedTask) {
        fastify.wsManager.broadcastToTenant(
          updatedTask.tenantId as TenantId,
          'task:created',
          updatedTask,
        );
      }

      return reply.status(201).send({
        _links: buildTaskLinks(id),
      });
    },
  );

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
  fastify.get(
    '/:id/logs',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_READ),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        querystring: zodToFastifySchema(taskLogsQuerySchema),
        tags: ['tasks'],
        summary: 'Get task logs',
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { level, executionId, source, from, to, limit, offset } =
        request.query as unknown as z.infer<typeof taskLogsQuerySchema>;

      // Verify task exists
      const task = await request.tPrisma.task.findUnique({
        where: { id },
        select: { id: true },
      });

      if (!task) {
        throw {
          statusCode: 404,
          message: 'Task not found',
          code: 'TASK_NOT_FOUND',
        };
      }

      const where: Prisma.TaskLogWhereInput = {
        taskId: id,
        ...(level && { level }),
        ...(executionId && { executionId }),
        ...(source && { source }),
        ...(from || to
          ? {
              timestamp: {
                ...(from && { gte: new Date(from) }),
                ...(to && { lte: new Date(to) }),
              },
            }
          : {}),
      };

      const [logs, total, levelCounts] = await Promise.all([
        request.tPrisma.taskLog.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          skip: offset,
          take: limit,
        }),
        request.tPrisma.taskLog.count({ where }),
        request.tPrisma.taskLog.groupBy({
          by: ['level'],
          where: { taskId: id },
          _count: true,
        }),
      ]);

      const firstLog = await request.tPrisma.taskLog.findFirst({
        where: { taskId: id },
        orderBy: { timestamp: 'asc' },
        select: { timestamp: true },
      });

      const lastLog = await request.tPrisma.taskLog.findFirst({
        where: { taskId: id },
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true },
      });

      return {
        taskId: id,
        logs,
        pagination: { limit, offset, total },
        summary: {
          byLevel: levelCounts.reduce(
            (acc: any, l: any) => ({ ...acc, [l.level]: l._count }),
            {},
          ),
          firstLog: firstLog?.timestamp,
          lastLog: lastLog?.timestamp,
        },
        _links: buildTaskLinks(id),
      };
    },
  );

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
  fastify.get(
    '/:id/history',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_READ),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        querystring: zodToFastifySchema(taskHistoryQuerySchema),
        tags: ['tasks'],
        summary: 'Get task execution history',
        description:
          'Returns complete execution history including all attempts',
      },
    },
    async (request: any, reply: any) => {
      const { id } = request.params;
      const { includeExecutions, includeLogs, limit } = request.query;

      const task = await request.tPrisma.task.findUnique({
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
                  orderBy: { timestamp: 'desc' },
                  take: 100,
                },
              }),
            },
          },
        },
      });

      if (!task) {
        return reply.status(404).send({
          error: {
            code: 'TASK_NOT_FOUND',
            message: 'Task not found',
            requestId: request.id,
          },
        });
      }

      // Build timeline from logs
      const timelineLogs = await request.tPrisma.taskLog.findMany({
        where: {
          taskId: id,
          source: 'scheduler',
        },
        orderBy: { timestamp: 'asc' },
      });

      const timeline = [
        { timestamp: task.submittedAt, event: 'created', details: {} },
        ...timelineLogs.map((log: any) => ({
          timestamp: log.timestamp,
          event: log.message.toLowerCase().replace(/\s+/g, '_'),
          details: (log.metadata as Record<string, unknown>) ?? {},
        })),
      ];

      // Calculate summary
      const { executions } = task;
      const completedExecutions = executions.filter(
        (e: any) => e.status === 'COMPLETED',
      );
      const totalDuration = executions.reduce(
        (sum: any, e: any) => sum + (e.durationMs ?? 0),
        0,
      );
      const totalCost = executions.reduce(
        (sum: any, e: any) => sum + (e.costUSD ?? 0),
        0,
      );

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
          successRate:
            executions.length > 0
              ? completedExecutions.length / executions.length
              : 0,
          avgDurationMs:
            executions.length > 0 ? totalDuration / executions.length : 0,
        },
        _links: buildTaskLinks(id),
      };
    },
  );

  // ==========================================================================
  // 8. STATS - Task statistics
  // ==========================================================================
  fastify.get(
    '/stats',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_READ),
      ],
      schema: {
        tags: ['tasks'],
        summary: 'Get task statistics',
      },
    },
    async (request: any) => {
      const [byStatus, byPriority, byType, avgDuration, recentTasks] =
        await Promise.all([
          request.tPrisma.task.groupBy({
            by: ['status'],
            _count: true,
          }),
          request.tPrisma.task.groupBy({
            by: ['priority'],
            _count: true,
          }),
          request.tPrisma.task.groupBy({
            by: ['type'],
            _count: true,
          }),
          request.tPrisma.taskExecution.aggregate({
            where: {
              status: 'COMPLETED',
            },
            _avg: { durationMs: true },
          }),
          request.tPrisma.task.count({
            where: {
              submittedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
          }),
        ]);

      return {
        byStatus: byStatus.reduce(
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
        avgDurationMs: avgDuration._avg.durationMs ?? 0,
        recentTasks24h: recentTasks,
        queueDepth:
          byStatus.find((s: any) => s.status === 'PENDING')?._count ?? 0,
        runningCount:
          byStatus.find((s: any) => s.status === 'RUNNING')?._count ?? 0,
      };
    },
  );
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
  };
}
