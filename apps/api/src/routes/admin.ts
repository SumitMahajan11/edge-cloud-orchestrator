import { Permissions } from '@edgecloud/shared-kernel';
import { FastifyInstance } from 'fastify';
import { zodToFastifySchema } from '../utils/zod-schema.js';
import {
  adminUserRoleParamSchema,
  adminUserRoleBodySchema,
  adminDeactivateParamSchema,
  adminCleanupBodySchema,
  adminEventRepublishBodySchema,
  adminEventRepublishRangeBodySchema,
  adminDlqEventsQuerySchema,
  adminDlqEventRetryParamSchema,
  adminDlqPurgeBodySchema,
} from '../schemas';

type UserRoleStr = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER';

export default async function adminRoutes(fastify: FastifyInstance) {
  // WebSocket Statistics
  fastify.get(
    '/ws-stats',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
      schema: {
        tags: ['admin'],
        summary: 'Get WebSocket statistics',
      },
    },
    async () => {
      return fastify.wsManager.getStats();
    },
  );

  // Get audit logs
  fastify.get<{
    Querystring: { userId?: string; action?: string; limit?: number };
  }>(
    '/audit-logs',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.AUDIT_READ),
      ],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            action: { type: 'string' },
            limit: { type: 'number', default: 100 },
          },
        },
        tags: ['admin'],
        summary: 'Get audit logs',
      },
    },
    async (request, _reply) => {
      const { userId, action, limit = 100 } = request.query;

      const where = {
        tenantId: request.user!.tenantId!,
        ...(userId && { userId }),
        ...(action && { action }),
      };

      const [logs, total] = await Promise.all([
        fastify.prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          include: {
            user: {
              select: { id: true, email: true, name: true },
            },
          },
        }),
        fastify.prisma.auditLog.count({ where }),
      ]);

      return {
        data: logs,
        pagination: {
          page: 1,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: limit < total,
          hasPrev: false,
        },
      };
    },
  );

  // List users
  fastify.get(
    '/users',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TENANT_MANAGE),
      ],
      schema: {
        tags: ['admin'],
        summary: 'List all users',
      },
    },
    async (request, _reply) => {
      const limit = 50;
      const where = {
        tenantUsers: {
          some: {
            tenantId: request.user!.tenantId!,
          },
        },
      };

      const [users, total] = await Promise.all([
        fastify.prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
            emailVerified: true,
            createdAt: true,
            lastLoginAt: true,
            _count: { select: { userSessions: true, apiKeys: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),
        fastify.prisma.user.count({ where }),
      ]);

      return {
        data: users,
        pagination: {
          page: 1,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: limit < total,
          hasPrev: false,
        },
      };
    },
  );

  // Update user role
  fastify.patch<{ Params: { id: string }; Body: { role: UserRoleStr } }>(
    '/users/:id/role',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TENANT_MANAGE),
      ],
      schema: {
        params: zodToFastifySchema(adminUserRoleParamSchema),
        body: zodToFastifySchema(adminUserRoleBodySchema),
        tags: ['admin'],
        summary: 'Update user role',
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { role } = request.body;

      const currentUser = request.user as { id: string; tenantId: string };
      if (id === currentUser.id) {
        return reply.status(400).send({
          error: {
            code: 'FORBIDDEN',
            message: 'Cannot change your own role',
            requestId: request.id,
          },
        });
      }

      // Verify target user belongs to the same tenant
      const tenantUser = await fastify.prisma.tenantUser.findFirst({
        where: {
          userId: id,
          tenantId: currentUser.tenantId,
        },
      });

      if (!tenantUser) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'User not found in your tenant',
            requestId: request.id,
          },
        });
      }

      const user = await fastify.prisma.user.update({
        where: { id },
        data: { role: role as any },
      });

      // Audit log
      await fastify.prisma.auditLog.create({
        data: {
          userId: currentUser.id,
          tenantId: request.user!.tenantId!,
          action: 'user.role_changed',
          entityType: 'user',
          entityId: id,
          details: { newRole: role } as any,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
      });

      return user;
    },
  );

  // Deactivate user
  fastify.post<{ Params: { id: string } }>(
    '/users/:id/deactivate',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TENANT_MANAGE),
      ],
      schema: {
        params: zodToFastifySchema(adminDeactivateParamSchema),
        tags: ['admin'],
        summary: 'Deactivate user',
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const currentUser = request.user as { id: string; tenantId: string };
      if (id === currentUser.id) {
        return reply.status(400).send({
          error: {
            code: 'FORBIDDEN',
            message: 'Cannot deactivate yourself',
            requestId: request.id,
          },
        });
      }

      // Verify target user belongs to the same tenant
      const tenantUser = await fastify.prisma.tenantUser.findFirst({
        where: {
          userId: id,
          tenantId: currentUser.tenantId,
        },
      });

      if (!tenantUser) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'User not found in your tenant',
            requestId: request.id,
          },
        });
      }

      const user = await fastify.prisma.user.update({
        where: { id },
        data: { isActive: false },
      });

      // Invalidate all sessions
      await fastify.prisma.userSession.deleteMany({ where: { userId: id } });

      return user;
    },
  );

  // Get system health
  fastify.get(
    '/health',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.SYSTEM_READ),
      ],
      schema: {
        tags: ['admin'],
        summary: 'Get system health',
      },
    },
    async (_request, _reply) => {
      const [dbHealth, redisHealth] = await Promise.all([
        fastify.prisma.$queryRaw`SELECT 1`
          .then(() => 'healthy')
          .catch(() => 'unhealthy'),
        fastify.redis
          .ping()
          .then(() => 'healthy')
          .catch(() => 'unhealthy'),
      ]);

      return {
        database: dbHealth,
        redis: redisHealth,
        timestamp: new Date().toISOString(),
      };
    },
  );

  // Clear old data
  fastify.post<{ Body: { olderThanDays: number; types: string[] } }>(
    '/cleanup',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TENANT_MANAGE),
      ],
      schema: {
        body: zodToFastifySchema(adminCleanupBodySchema),
        tags: ['admin'],
        summary: 'Clean up old data',
      },
    },
    async (request, _reply) => {
      const { olderThanDays, types } = request.body;
      const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

      const results: Record<string, number> = {};

      if (types.includes('metrics')) {
        results.nodeMetrics = await fastify.prisma.nodeMetric
          .deleteMany({
            where: {
              timestamp: { lt: cutoff },
              node: { tenantId: request.user!.tenantId! },
            },
          })
          .then((r) => r.count);
      }

      if (types.includes('logs')) {
        results.taskLogs = await fastify.prisma.taskLog
          .deleteMany({
            where: {
              timestamp: { lt: cutoff },
              task: { tenantId: request.user!.tenantId! },
            },
          })
          .then((r) => r.count);
      }

      if (types.includes('webhookDeliveries')) {
        results.webhookDeliveries = await fastify.prisma.webhookDelivery
          .deleteMany({
            where: {
              createdAt: { lt: cutoff },
              tenantId: request.user!.tenantId!,
            },
          })
          .then((r) => r.count);
      }

      if (types.includes('auditLogs')) {
        results.auditLogs = await fastify.prisma.auditLog
          .deleteMany({
            where: {
              createdAt: { lt: cutoff },
              tenantId: request.user!.tenantId!,
            },
          })
          .then((r) => r.count);
      }

      return { deleted: results, cutoff: cutoff.toISOString() };
    },
  );

  // ML retrain endpoint
  fastify.post(
    '/ml/retrain',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.ML_RETRAIN),
      ],
      schema: {
        tags: ['admin'],
        summary: 'Trigger ML model retraining',
      },
    },
    async (request, reply) => {
      const scheduler = fastify.taskScheduler;
      if (!scheduler) {
        return reply.status(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'TaskScheduler not initialized',
            requestId: request.id,
          },
        });
      }

      const { spawn } = await import('child_process');
      const path = await import('path');
      const fs = await import('fs');

      // 1. Extract data
      const trainingData =
        await scheduler.featureExtractor.extractTrainingData();
      if (trainingData.length < 50) {
        return reply.status(400).send({
          error: {
            code: 'INSUFFICIENT_DATA',
            message: 'Insufficient training data (need at least 50 samples)',
            requestId: request.id,
          },
        });
      }

      // 2. Write to temp file
      const tempPath = path.join(process.cwd(), 'temp_training_data.json');
      fs.writeFileSync(tempPath, JSON.stringify(trainingData));

      // 3. Spawn Python process
      const pythonScript = path.join(
        process.cwd(),
        '../../packages/ml-scheduler/src/training/train_model.py',
      );
      const modelDir = path.join(process.cwd(), 'models');

      return new Promise((resolve, _reject) => {
        const pyProcess = spawn('python', [pythonScript, tempPath, modelDir]);

        let output = '';
        pyProcess.stdout.on('data', (data) => (output += data.toString()));
        pyProcess.stderr.on('data', (data) => (output += data.toString()));

        pyProcess.on('close', async (code) => {
          // Cleanup temp file
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }

          if (code !== 0) {
            fastify.log.error({ output }, 'ML retraining failed');
            return resolve(
              reply.status(500).send({
                error: {
                  code: 'TRAINING_FAILED',
                  message: 'Training process failed',
                },
              }),
            );
          }

          // Parse version from output or latest.json
          try {
            const latestPath = path.join(modelDir, 'latest.json');
            const latest = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));

            // 4. Promote new model
            await (scheduler as any).modelRegistry.promoteModel(latest.version);

            resolve({
              status: 'success',
              version: latest.version,
              mae: latest.mae,
            });
          } catch (e) {
            resolve(
              reply.status(500).send({
                error: {
                  code: 'MODEL_PROMOTION_FAILED',
                  message: 'Failed to promote model',
                },
              }),
            );
          }
        });
      });
    },
  );

  // ============================================
  // Event Republishing
  // ============================================

  // Single event republish
  fastify.post<{
    Body: {
      eventType: string;
      entityId: string;
      targetTopic?: string;
    };
  }>(
    '/events/republish',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.EVENT_REPUBLISH),
      ],
      config: {
        rateLimit: { max: 10, timeWindow: 60000 },
      },
      schema: {
        body: zodToFastifySchema(adminEventRepublishBodySchema),
        tags: ['admin'],
        summary: 'Republish an event to Kafka',
      },
    },
    async (request, reply) => {
      const currentUser = request.user as {
        id: string;
        tenantId?: string;
        role: string;
      };
      if (currentUser.tenantId && currentUser.tenantId !== 'SYSTEM') {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: 'Tenant-scoped tokens cannot republish events',
            requestId: request.id,
          },
        });
      }

      const { eventType, entityId, targetTopic } = request.body;

      let payload: any = null;
      let defaultTopic = '';

      if (eventType === 'task.created') {
        const task = await fastify.prisma.task.findUnique({
          where: { id: entityId },
        });
        if (!task) {
          return reply.status(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'Task not found',
              requestId: request.id,
            },
          });
        }
        payload = {
          eventType: 'TaskCreated',
          taskId: task.id,
          name: task.name,
          type: task.type,
          priority: task.priority,
          target: (task as any).targetNodeId || task.nodeId || '',
          region: (task as any).region || '',
          aggregateId: task.id,
          version: 1,
        };
        defaultTopic = 'tasks.events';
      } else if (eventType === 'node.registered') {
        const node = await fastify.prisma.edgeNode.findUnique({
          where: { id: entityId },
        });
        if (!node) {
          return reply.status(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'Node not found',
              requestId: request.id,
            },
          });
        }
        payload = {
          eventType: 'NodeRegistered',
          nodeId: node.id,
          name: node.name,
          region: node.region || '',
          capabilities: (node as any).capabilities || [],
          aggregateId: node.id,
          version: 1,
        };
        defaultTopic = 'nodes.events';
      } else {
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: `Unsupported event type: ${eventType}`,
            requestId: request.id,
          },
        });
      }

      const topic = targetTopic || defaultTopic;

      // @ts-ignore
      const { EventBus } = await import('@edgecloud/event-bus');
      const { env } = await import('../config/env.js');
      const eventBus = new EventBus({
        clientId: 'admin-republisher',
        brokers: env.KAFKA_BROKERS.split(','),
      });
      await eventBus.connect();
      await eventBus.publish(topic, payload);
      await eventBus.disconnect();

      await fastify.prisma.auditLog.create({
        data: {
          userId: currentUser.id,
          tenantId: 'SYSTEM',
          action: 'event.republished',
          entityType: 'event',
          entityId: entityId,
          details: { eventType, topic } as any,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
      });

      return { success: true, topic };
    },
  );

  // Bulk event republish
  fastify.post<{
    Body: {
      eventType: string;
      fromTimestamp: string;
      toTimestamp: string;
      dryRun?: boolean;
    };
  }>(
    '/events/republish-range',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.EVENT_REPUBLISH),
      ],
      config: {
        rateLimit: { max: 10, timeWindow: 60000 },
      },
      schema: {
        body: zodToFastifySchema(adminEventRepublishRangeBodySchema),
        tags: ['admin'],
        summary: 'Bulk republish events to Kafka',
      },
    },
    async (request, reply) => {
      const currentUser = request.user as {
        id: string;
        tenantId?: string;
        role: string;
      };
      if (currentUser.tenantId && currentUser.tenantId !== 'SYSTEM') {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: 'Tenant-scoped tokens cannot republish events',
            requestId: request.id,
          },
        });
      }

      const { eventType, fromTimestamp, toTimestamp, dryRun } = request.body;
      const fromDate = new Date(fromTimestamp);
      const toDate = new Date(toTimestamp);

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid timestamps',
            requestId: request.id,
          },
        });
      }

      let entities: any[] = [];
      let defaultTopic = '';

      if (eventType === 'task.created') {
        entities = await fastify.prisma.task.findMany({
          where: {
            submittedAt: { gte: fromDate, lte: toDate },
          },
          take: 1000,
        });
        defaultTopic = 'tasks.events';
      } else if (eventType === 'node.registered') {
        entities = await fastify.prisma.edgeNode.findMany({
          where: {
            createdAt: { gte: fromDate, lte: toDate },
          },
          take: 1000,
        });
        defaultTopic = 'nodes.events';
      } else {
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: `Unsupported event type: ${eventType}`,
            requestId: request.id,
          },
        });
      }

      if (dryRun) {
        return {
          count: entities.length,
          events: entities.slice(0, 10),
        };
      }

      // @ts-ignore
      const { EventBus } = await import('@edgecloud/event-bus');
      const { env } = await import('../config/env.js');
      const eventBus = new EventBus({
        clientId: 'admin-republisher-bulk',
        brokers: env.KAFKA_BROKERS.split(','),
      });
      await eventBus.connect();

      let published = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const entity of entities) {
        try {
          let payload: any = null;
          if (eventType === 'task.created') {
            payload = {
              eventType: 'TaskCreated',
              taskId: entity.id,
              name: entity.name,
              type: entity.type,
              priority: entity.priority,
              target: entity.targetNodeId || '',
              region: entity.region || '',
              aggregateId: entity.id,
              version: 1,
            };
          } else if (eventType === 'node.registered') {
            payload = {
              eventType: 'NodeRegistered',
              nodeId: entity.id,
              name: entity.name,
              region: entity.region || '',
              capabilities: (entity as any).capabilities || [],
              aggregateId: entity.id,
              version: 1,
            };
          }
          await eventBus.publish(defaultTopic, payload);
          published++;
        } catch (err) {
          failed++;
          errors.push(`Entity ${entity.id}: ${(err as any).message}`);
        }
      }

      await eventBus.disconnect();

      await fastify.prisma.auditLog.create({
        data: {
          userId: currentUser.id,
          tenantId: 'SYSTEM',
          action: 'event.republished_bulk',
          entityType: 'event',
          entityId: 'range',
          details: { eventType, fromTimestamp, toTimestamp, published } as any,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
      });

      return { published, failed, errors };
    },
  );

  // ============================================

  // DLQ Monitoring Endpoints
  // ============================================

  // Get DLQ statistics
  fastify.get(
    '/dlq/stats',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.AUDIT_READ),
      ],
      schema: {
        tags: ['admin'],
        summary: 'Get DLQ statistics across all streams',
      },
    },
    async (_request, _reply) => {
      const dbStats = await fastify.prisma.deadLetterEvent.groupBy({
        by: ['status'],
        _count: { id: true },
      });

      const byTopic = await fastify.prisma.deadLetterEvent.groupBy({
        by: ['originalTopic'],
        _count: { id: true },
        where: { status: 'PENDING' },
      });

      const stats: any = {
        totalEvents: 0,
        pendingRetry: 0,
        permanentlyFailed: 0,
        reprocessed: 0,
        byTopic: {} as Record<string, number>,
      };

      dbStats.forEach((s: { status: string; _count: { id: number } }) => {
        stats.totalEvents += s._count.id;
        if (s.status === 'PENDING') {
          stats.pendingRetry = s._count.id;
        }
        if (s.status === 'PERMANENTLY_FAILED') {
          stats.permanentlyFailed = s._count.id;
        }
        if (s.status === 'REPROCESSED') {
          stats.reprocessed = s._count.id;
        }
      });

      byTopic.forEach(
        (t: { originalTopic: string; _count: { id: number } }) => {
          stats.byTopic[t.originalTopic] = t._count.id;
        },
      );

      return stats;
    },
  );

  // List DLQ events
  fastify.get<{
    Querystring: {
      topic?: string;
      status?: 'PENDING' | 'RETRYING' | 'REPROCESSED' | 'PERMANENTLY_FAILED';
      limit?: number;
      offset?: number;
    };
  }>(
    '/dlq/events',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.AUDIT_READ),
      ],
      schema: {
        querystring: zodToFastifySchema(adminDlqEventsQuerySchema),
        tags: ['admin'],
        summary: 'List DLQ events with filtering',
      },
    },
    async (request, _reply) => {
      const { topic, status, limit = 50, offset = 0 } = request.query;

      const where: any = {};
      if (topic) {
        where.originalTopic = topic;
      }
      if (status) {
        where.status = status;
      }

      const events = await fastify.prisma.deadLetterEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      });

      const total = await fastify.prisma.deadLetterEvent.count({ where });

      return {
        events,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      };
    },
  );

  // Retry DLQ event
  fastify.post<{ Params: { id: string } }>(
    '/dlq/events/:id/retry',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.EVENT_REPUBLISH),
      ],
      schema: {
        params: zodToFastifySchema(adminDlqEventRetryParamSchema),
        tags: ['admin'],
        summary: 'Retry a specific DLQ event',
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const event = await fastify.prisma.deadLetterEvent.findUnique({
        where: { id },
      });

      if (!event) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Event not found',
            requestId: request.id,
          },
        });
      }

      if (event.status === 'REPROCESSED') {
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: 'Event already reprocessed',
            requestId: request.id,
          },
        });
      }

      // Update status to RETRYING
      await fastify.prisma.deadLetterEvent.update({
        where: { id },
        data: {
          status: 'RETRYING',
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
        },
      });

      try {
        // @ts-ignore
        const { EventBus } = await import('@edgecloud/event-bus');
        const { env } = await import('../config/env.js');
        const eventBus = new EventBus({
          clientId: 'admin-dlq-retry',
          brokers: env.KAFKA_BROKERS.split(','),
        });
        await eventBus.connect();
        await eventBus.publish(event.originalTopic, event.payload);
        await eventBus.disconnect();

        await fastify.prisma.deadLetterEvent.update({
          where: { id },
          data: { status: 'REPROCESSED', error: '' },
        });
        return {
          success: true,
          eventId: id,
          message: 'Event successfully retried and published',
        };
      } catch (publishErr) {
        await fastify.prisma.deadLetterEvent.update({
          where: { id },
          data: {
            status: 'PENDING',
            error: (publishErr as Error).message,
          },
        });
        return reply.status(500).send({
          error: {
            code: 'PUBLISH_FAILED',
            message: 'Failed to republish event to Kafka',
            requestId: request.id,
          },
        });
      }
    },
  );

  // Purge old DLQ events
  fastify.post<{
    Body: { olderThanDays?: number };
  }>(
    '/dlq/purge',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TENANT_MANAGE),
      ],
      schema: {
        body: zodToFastifySchema(adminDlqPurgeBodySchema),
        tags: ['admin'],
        summary: 'Purge old DLQ events',
      },
    },
    async (request, _reply) => {
      const { olderThanDays = 7 } = request.body;

      const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

      const result = await (fastify.prisma as any).deadLetterEvent.deleteMany({
        where: {
          status: { in: ['REPROCESSED', 'PERMANENTLY_FAILED'] },
          createdAt: { lt: cutoff },
        },
      });

      return { purged: result.count, olderThanDays };
    },
  );
}
