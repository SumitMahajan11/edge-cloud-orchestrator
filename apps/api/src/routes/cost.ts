import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { costQuerySchema } from '../schemas';
import { zodToFastifySchema } from '../utils/zod-schema';

export default async function costRoutes(fastify: FastifyInstance) {
  // Get cost summary
  fastify.get(
    '/summary',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['cost'],
        summary: 'Get cost summary',
      },
    },
    async (request, _reply) => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(
        now.getFullYear(),
        now.getMonth() - 1,
        1,
      );

      const [currentMonth, lastMonth, byResourceType] = await Promise.all([
        (fastify.prisma as any).costRecord.aggregate({
          where: { 
            recordedAt: { gte: startOfMonth },
            tenantId: request.user!.tenantId!
          },
          _sum: { cost: true },
        }),
        (fastify.prisma as any).costRecord.aggregate({
          where: {
            recordedAt: { gte: startOfLastMonth, lt: startOfMonth },
            tenantId: request.user!.tenantId!
          },
          _sum: { cost: true },
        }),
        (fastify.prisma as any).costRecord.groupBy({
          by: ['resourceType'],
          where: { tenantId: request.user!.tenantId! },
          _sum: { cost: true },
        }),
      ]);

      const currentTotal = currentMonth._sum.cost || 0;
      const lastTotal = lastMonth._sum.cost || 0;
      const change =
        lastTotal > 0 ? ((currentTotal - lastTotal) / lastTotal) * 100 : 0;

      return {
        currentMonth: currentTotal,
        lastMonth: lastTotal,
        changePercent: change.toFixed(2),
        byResourceType: byResourceType.reduce(
          (acc: any, r: any) => ({
            ...acc,
            [r.resourceType]: r._sum.cost || 0,
          }),
          {},
        ),
      };
    },
  );

  // Get cost records
  fastify.get<{ Querystring: z.infer<typeof costQuerySchema> }>(
    '/records',
    {
      preHandler: [fastify.authenticate],
      schema: {
        querystring: zodToFastifySchema(costQuerySchema),
        tags: ['cost'],
        summary: 'Get cost records',
      },
    },
    async (request, _reply) => {
      const {
        nodeId,
        resourceType,
        from,
        to,
        granularity: _granularity,
      } = request.query;

      const records = await (fastify.prisma as any).costRecord.findMany({
        where: {
          tenantId: request.user!.tenantId!,
          ...(nodeId && { nodeId }),
          ...(resourceType && { resourceType }),
          ...(from && { recordedAt: { gte: new Date(from) } }),
          ...(to && { recordedAt: { lte: new Date(to) } }),
        },
        orderBy: { recordedAt: 'desc' },
        take: 1000,
      });

      return records;
    },
  );

  // Get cost by node
  fastify.get(
    '/by-node',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['cost'],
        summary: 'Get cost breakdown by node',
      },
    },
    async (request, _reply) => {
      const byNode = await (fastify.prisma as any).costRecord.groupBy({
        by: ['nodeId'],
        where: { tenantId: request.user!.tenantId! },
        _sum: { cost: true },
        _count: true,
      });

      // Get node names
      const nodeIds = byNode.map((n: any) => n.nodeId).filter(Boolean) as string[];
      const nodes = await fastify.prisma.edgeNode.findMany({
        where: { id: { in: nodeIds }, tenantId: request.user!.tenantId! },
        select: { id: true, name: true, region: true },
      });

      const nodeMap = nodes.reduce(
        (acc: any, n: any) => ({ ...acc, [n.id]: n }),
        {} as Record<string, (typeof nodes)[0]>,
      );

      return byNode.map((n: any) => ({
        nodeId: n.nodeId,
        node: n.nodeId ? nodeMap[n.nodeId] : null,
        totalCost: n._sum.cost || 0,
        recordCount: n._count,
      }));
    },
  );

  // Cost projections
  fastify.get(
    '/projections',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['cost'],
        summary: 'Get cost projections',
      },
    },
    async (request, _reply) => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const dayOfMonth = now.getDate();
      const daysInMonth = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
      ).getDate();

      const monthToDate = await (fastify.prisma as any).costRecord.aggregate({
        where: { 
          recordedAt: { gte: startOfMonth },
          tenantId: request.user!.tenantId!
        },
        _sum: { cost: true },
      });

      const mtdCost = monthToDate._sum.cost || 0;
      const dailyAvg = mtdCost / dayOfMonth;
      const projectedMonth = dailyAvg * daysInMonth;

      return {
        monthToDate: mtdCost,
        dailyAverage: dailyAvg,
        projectedMonth,
        daysRemaining: daysInMonth - dayOfMonth,
      };
    },
  );
}

