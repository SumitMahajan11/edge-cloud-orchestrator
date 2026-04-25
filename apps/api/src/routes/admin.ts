import { FastifyInstance } from 'fastify';

type UserRoleStr = 'ADMIN' | 'OPERATOR' | 'VIEWER';

export default async function adminRoutes(fastify: FastifyInstance) {
  // Get audit logs
  fastify.get<{
    Querystring: { userId?: string; action?: string; limit?: number };
  }>(
    '/audit-logs',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
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

      const logs = await fastify.prisma.auditLog.findMany({
        where: {
          ...(userId && { userId }),
          ...(action && { action }),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          user: {
            select: { id: true, email: true, name: true },
          },
        },
      });

      return logs;
    },
  );

  // List users
  fastify.get(
    '/users',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
      schema: {
        tags: ['admin'],
        summary: 'List all users',
      },
    },
    async (_request, _reply) => {
      const users = await fastify.prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          emailVerified: true,
          createdAt: true,
          lastLoginAt: true,
          _count: { select: { sessions: true, apiKeys: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return users;
    },
  );

  // Update user role
  fastify.patch<{ Params: { id: string }; Body: { role: UserRoleStr } }>(
    '/users/:id/role',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
      schema: {
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['ADMIN', 'OPERATOR', 'VIEWER'] },
          },
          required: ['role'],
        },
        tags: ['admin'],
        summary: 'Update user role',
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { role } = request.body;

      const currentUser = request.user as { id: string };
      if (id === currentUser.id) {
        return reply.status(400).send({ error: 'Cannot change your own role' });
      }

      const user = await fastify.prisma.user.update({
        where: { id },
        data: { role },
      });

      // Audit log
      await fastify.prisma.auditLog.create({
        data: {
          userId: currentUser.id,
          action: 'user.role_changed',
          entityType: 'user',
          entityId: id,
          details: { newRole: role },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      });

      return user;
    },
  );

  // Deactivate user
  fastify.post<{ Params: { id: string } }>(
    '/users/:id/deactivate',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
      schema: {
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
        tags: ['admin'],
        summary: 'Deactivate user',
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const currentUser = request.user as { id: string };
      if (id === currentUser.id) {
        return reply.status(400).send({ error: 'Cannot deactivate yourself' });
      }

      const user = await fastify.prisma.user.update({
        where: { id },
        data: { isActive: false },
      });

      // Invalidate all sessions
      await fastify.prisma.session.deleteMany({ where: { userId: id } });

      return user;
    },
  );

  // Get system health
  fastify.get(
    '/health',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
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
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
      schema: {
        body: {
          type: 'object',
          properties: {
            olderThanDays: { type: 'number' },
            types: { type: 'array', items: { type: 'string' } },
          },
          required: ['olderThanDays', 'types'],
        },
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
            where: { timestamp: { lt: cutoff } },
          })
          .then((r) => r.count);
      }

      if (types.includes('logs')) {
        results.taskLogs = await fastify.prisma.taskLog
          .deleteMany({
            where: { timestamp: { lt: cutoff } },
          })
          .then((r) => r.count);
      }

      if (types.includes('webhookDeliveries')) {
        results.webhookDeliveries = await fastify.prisma.webhookDelivery
          .deleteMany({
            where: { createdAt: { lt: cutoff } },
          })
          .then((r) => r.count);
      }

      if (types.includes('auditLogs')) {
        results.auditLogs = await fastify.prisma.auditLog
          .deleteMany({
            where: { createdAt: { lt: cutoff } },
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
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
      schema: {
        tags: ['admin'],
        summary: 'Trigger ML model retraining',
      },
    },
    async (_request, reply) => {
      const scheduler = (fastify as any).taskScheduler;
      if (!scheduler) {
        return reply.status(500).send({ error: 'TaskScheduler not initialized' });
      }

      const { spawn } = await import('child_process');
      const path = await import('path');
      const fs = await import('fs');

      // 1. Extract data
      const trainingData = await scheduler.featureExtractor.extractTrainingData();
      if (trainingData.length < 50) {
        return reply.status(400).send({ error: 'Insufficient training data (need at least 50 samples)' });
      }

      // 2. Write to temp file
      const tempPath = path.join(process.cwd(), 'temp_training_data.json');
      fs.writeFileSync(tempPath, JSON.stringify(trainingData));

      // 3. Spawn Python process
      const pythonScript = path.join(process.cwd(), '../../packages/ml-scheduler/src/training/train_model.py');
      const modelDir = path.join(process.cwd(), 'models');

      return new Promise((resolve, _reject) => {
        const pyProcess = spawn('python', [pythonScript, tempPath, modelDir]);
        
        let output = '';
        pyProcess.stdout.on('data', (data) => output += data.toString());
        pyProcess.stderr.on('data', (data) => output += data.toString());

        pyProcess.on('close', async (code) => {
          // Cleanup temp file
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

          if (code !== 0) {
            fastify.log.error({ output }, 'ML retraining failed');
            return resolve(reply.status(500).send({ error: 'Training process failed', details: output }));
          }

          // Parse version from output or latest.json
          try {
            const latestPath = path.join(modelDir, 'latest.json');
            const latest = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));
            
            // 4. Promote new model
            await scheduler.modelRegistry.promoteModel(latest.version);
            
            resolve({ 
              status: 'success', 
              version: latest.version, 
              mae: latest.mae 
            });
          } catch (e) {
            resolve(reply.status(500).send({ error: 'Failed to promote model', details: (e as Error).message }));
          }
        });
      });
    },
  );

  // ============================================
  // DLQ Monitoring Endpoints
  // ============================================

  // Get DLQ statistics
  fastify.get(
    '/dlq/stats',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
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
        if (s.status === 'PENDING') stats.pendingRetry = s._count.id;
        if (s.status === 'PERMANENTLY_FAILED') stats.permanentlyFailed = s._count.id;
        if (s.status === 'REPROCESSED') stats.reprocessed = s._count.id;
      });

      byTopic.forEach((t: { originalTopic: string; _count: { id: number } }) => {
        stats.byTopic[t.originalTopic] = t._count.id;
      });

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
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            topic: { type: 'string' },
            status: { type: 'string', enum: ['PENDING', 'RETRYING', 'REPROCESSED', 'PERMANENTLY_FAILED'] },
            limit: { type: 'number', default: 50 },
            offset: { type: 'number', default: 0 },
          },
        },
        tags: ['admin'],
        summary: 'List DLQ events with filtering',
      },
    },
    async (request, _reply) => {
      const { topic, status, limit = 50, offset = 0 } = request.query;

      const where: any = {};
      if (topic) where.originalTopic = topic;
      if (status) where.status = status;

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
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
      schema: {
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        tags: ['admin'],
        summary: 'Retry a specific DLQ event',
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const event = await fastify.prisma.deadLetterEvent.findUnique({
          where: { id },
        });

        if (!event) {
          return reply.status(404).send({ error: 'Event not found' });
        }

        if (event.status === 'REPROCESSED') {
          return reply.status(400).send({ error: 'Event already reprocessed' });
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

        // TODO: Republish to Kafka topic via event bus
        // For now, just mark as retrying

        return { success: true, eventId: id, message: 'Event marked for retry' };
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    },
  );

  // Purge old DLQ events
  fastify.post<{
    Body: { olderThanDays?: number };
  }>(
    '/dlq/purge',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
      schema: {
        body: {
          type: 'object',
          properties: {
            olderThanDays: { type: 'number', default: 7 },
          },
        },
        tags: ['admin'],
        summary: 'Purge old DLQ events',
      },
    },
    async (request, _reply) => {
      const { olderThanDays = 7 } = request.body;

      const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

      const result = await fastify.prisma.deadLetterEvent.deleteMany({
        where: {
          status: { in: ['REPROCESSED', 'PERMANENTLY_FAILED'] },
          createdAt: { lt: cutoff },
        },
      });

      return { purged: result.count, olderThanDays };
    },
  );
}
