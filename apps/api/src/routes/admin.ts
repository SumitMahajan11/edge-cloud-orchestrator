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
    async (request, reply) => {
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

      return new Promise((resolve, reject) => {
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
}
