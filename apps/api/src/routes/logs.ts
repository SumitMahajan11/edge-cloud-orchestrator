import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { zodToFastifySchema } from '../utils/zod-schema.js';

const LogQuerySchema = z.object({
  taskId: z.string().optional(),
  nodeId: z.string().optional(),
  level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional(),
  limit: z.coerce.number().default(100),
  offset: z.coerce.number().default(0),
});

export default async function logRoutes(fastify: FastifyInstance) {
  // Get global logs
  fastify.get(
    '/',
    {
      preHandler: [fastify.authenticate],
      schema: {
        querystring: zodToFastifySchema(LogQuerySchema),
        tags: ['logs'],
        summary: 'Get system-wide logs',
      },
    },
    async (request, _reply) => {
      const { taskId, nodeId, level, limit, offset } = request.query as any;
      const tenantId = request.user!.tenantId!;

      const logs = await fastify.prisma.taskLog.findMany({
        where: {
          tenantId,
          ...(taskId ? { taskId } : {}),
          ...(nodeId ? { execution: { nodeId } } : {}),
          ...(level ? { level } : {}),
        },
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
        include: {
          task: { select: { name: true } },
        },
      });

      return logs;
    },
  );

  // Get log statistics
  fastify.get(
    '/stats',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['logs'],
        summary: 'Get log statistics',
      },
    },
    async (request, _reply) => {
      const tenantId = request.user!.tenantId!;

      const [total, errors] = await Promise.all([
        fastify.prisma.taskLog.count({ where: { tenantId } }),
        fastify.prisma.taskLog.count({ 
          where: { 
            tenantId, 
            level: 'ERROR',
            timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          } 
        }),
      ]);

      return {
        total,
        errorsLast24h: errors,
        storageUsageGB: 1.2,
      };
    },
  );
}
