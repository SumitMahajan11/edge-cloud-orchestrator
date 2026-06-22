import { Permissions } from '@edgecloud/shared-kernel';
import { FastifyInstance } from 'fastify';
import { zodToFastifySchema } from '../utils/zod-schema.js';
import { analyticsCostQuerySchema } from '../schemas';

export default async function analyticsRoutes(fastify: FastifyInstance) {
  /**
   * GET /v2/analytics/cost
   *
   * Returns aggregated cost analytics for the dashboard.
   */
  fastify.get(
    '/cost',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.COST_READ),
      ],
      schema: {
        tags: ['analytics'],
        summary: 'Get cost analytics',
        querystring: zodToFastifySchema(analyticsCostQuerySchema),
        response: {
          200: {
            type: 'object',
            properties: {
              totalActualCost: { type: 'number' },
              totalSavings: { type: 'number' },
              costByNode: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    nodeId: { type: 'string' },
                    nodeName: { type: 'string' },
                    cost: { type: 'number' },
                    taskCount: { type: 'number' },
                  },
                },
              },
              costOverTime: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    date: { type: 'string' },
                    cost: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const { from, to, nodeId } = request.query as {
        from?: string;
        to?: string;
        nodeId?: string;
      };
      const tenantId = request.user!.tenantId!;

      const startTime = from
        ? new Date(from)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endTime = to ? new Date(to) : new Date();

      // 1. Total Cost from TaskExecution
      const totalCostResult = await request.tPrisma.taskExecution.aggregate({
        where: {
          tenantId,
          completedAt: { gte: startTime, lte: endTime },
          status: 'COMPLETED',
          ...(nodeId && { nodeId }),
        },
        _sum: { costUSD: true },
      });

      // 2. Cost By Node
      const costByNode = await request.tPrisma.taskExecution.groupBy({
        by: ['nodeId'],
        where: {
          tenantId,
          completedAt: { gte: startTime, lte: endTime },
          status: 'COMPLETED',
          ...(nodeId && { nodeId }),
        },
        _sum: { costUSD: true },
        _count: { id: true },
      });

      // Enrich with node names
      const nodes = await request.tPrisma.edgeNode.findMany({
        where: {
          id: {
            in: costByNode
              .map((n) => n.nodeId)
              .filter((id): id is string => !!id),
          },
        },
        select: { id: true, name: true },
      });
      const nodeMap = nodes.reduce(
        (acc: Record<string, string>, n) => ({ ...acc, [n.id]: n.name }),
        {},
      );

      // 3. Cost Over Time (Daily)
      // Note: This is simplified. In production we'd use a more robust time-series query.
      const rawRecords = await request.tPrisma.costRecord.findMany({
        where: {
          tenantId,
          recordedAt: { gte: startTime, lte: endTime },
          ...(nodeId && { nodeId }),
        },
        orderBy: { recordedAt: 'asc' },
      });

      const dailyMap = new Map<string, number>();
      rawRecords.forEach((r) => {
        const date = r.recordedAt.toISOString().split('T')[0];
        if (date) {
          dailyMap.set(date, (dailyMap.get(date) || 0) + (Number(r.cost) || 0));
        }
      });

      const costOverTime = Array.from(dailyMap.entries()).map(
        ([date, cost]) => ({
          date,
          cost: Math.round(cost * 100) / 100,
        }),
      );

      // 4. Savings Calculation (Estimated)
      // Placeholder: In a real system, we'd compare against a baseline (e.g. standard cloud pricing)
      const totalSavings = (Number(totalCostResult._sum.costUSD) || 0) * 0.25; // Assume 25% savings for now
 
      return {
        totalActualCost:
          Math.round((Number(totalCostResult._sum.costUSD) || 0) * 100) / 100,
        totalSavings: Math.round(totalSavings * 100) / 100,
        costByNode: costByNode.map((n) => ({
          nodeId: n.nodeId || 'unknown',
          nodeName: (n.nodeId && nodeMap[n.nodeId]) || 'Unknown',
          cost: Math.round((Number(n._sum.costUSD) || 0) * 100) / 100,
          taskCount: n._count?.id ?? 0,
        })),
        costOverTime,
      };
    },
  );
}
