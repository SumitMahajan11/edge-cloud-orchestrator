import { Permissions } from '@edgecloud/shared-kernel';
import { FastifyInstance } from 'fastify';
import { zodToFastifySchema } from '../utils/zod-schema.js';
import { schedulerDecisionsQuerySchema } from '../schemas';

export default async function schedulerRoutes(fastify: FastifyInstance) {
  // Get scheduler metrics
  fastify.get(
    '/metrics',
    {
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.SCHEDULER_READ)],
      schema: {
        tags: ['scheduler'],
        summary: 'Get scheduler-specific metrics',
        response: {
          200: {
            type: 'object',
            properties: {
              queueLength: { type: 'number' },
              avgSchedulingTime: { type: 'number' },
              throughput: { type: 'number' },
              efficiency: { type: 'number' },
            },
          }
        }
      },
    },
    async (_request, _reply) => {
      return {
        queueLength: 5,
        avgSchedulingTime: 45,
        throughput: 120,
        efficiency: 0.92,
      };
    },
  );

  // Get recent scheduling decisions
  fastify.get(
    '/decisions',
    {
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.SCHEDULER_READ)],
      schema: {
        tags: ['scheduler'],
        summary: 'Get recent scheduling decisions',
        querystring: zodToFastifySchema(schedulerDecisionsQuerySchema),
      },
    },
    async (request, _reply) => {
      const { nodeId, limit = 50 } = request.query as { nodeId?: string; limit?: number };
      
      const decisions = await (fastify as any).prisma.schedulingDecision.findMany({
        where: {
          tenantId: (request.user as any).tenantId,
          ...(nodeId && { selectedNodeId: nodeId }),
        },
        orderBy: { timestamp: 'desc' },
        take: limit,
      });

      return {
        data: decisions,
        pagination: {
          page: 1,
          limit: decisions.length || 50,
          total: decisions.length,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        }
      };
    },
  );
}
