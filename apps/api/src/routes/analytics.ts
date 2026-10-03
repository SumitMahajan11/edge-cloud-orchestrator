import { Permissions } from '@edgecloud/shared-kernel';
import type { FastifyInstance } from 'fastify';
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
      const tenantId = request.user.tenantId!;

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

  /**
   * GET /v2/analytics/governance
   *
   * Returns aggregated governance analytics for the policies dashboard.
   */
  fastify.get(
    '/governance',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.SCHEDULER_READ),
      ],
      schema: {
        tags: ['analytics'],
        summary: 'Get governance metrics',
        response: {
          200: {
            type: 'object',
            properties: {
              activeConstraints: { type: 'number' },
              policyViolations: { type: 'number' },
              complianceScore: { type: 'number' },
              totalNodes: { type: 'number' },
              onlineNodes: { type: 'number' },
            },
          },
        },
      },
    },
    async (request) => {
      const tenantId = request.user.tenantId!;

      // 1. Active Constraints: SchedulingPolicies (isActive) + AlertRules (enabled) + 12 baseline constraints
      const activePolicies = await request.tPrisma.schedulingPolicy.count({
        where: { tenantId, isActive: true },
      });
      const activeAlertRules = await request.tPrisma.alertRule.count({
        where: { tenantId, enabled: true },
      });
      const activeConstraints = activePolicies + activeAlertRules + 12;

      // 2. Policy Violations: anomalies in NodeHealthScore + offline nodes
      const allNodes = await request.tPrisma.edgeNode.findMany({
        where: { tenantId },
        select: { id: true, status: true },
      });
      const totalNodes = allNodes.length;
      const onlineNodes = allNodes.filter((n) => n.status === 'ONLINE').length;
      const offlineNodesCount = totalNodes - onlineNodes;

      const healthScores = await request.tPrisma.nodeHealthScore.findMany({
        where: { tenantId },
        select: { nodeId: true, isAnomaly: true, successRate: true },
      });

      const anomalyNodeIds = new Set(
        healthScores.filter((h) => h.isAnomaly).map((h) => h.nodeId)
      );

      const onlineAnomalyCount = allNodes.filter(
        (node) => node.status === 'ONLINE' && anomalyNodeIds.has(node.id)
      ).length;

      const policyViolations = offlineNodesCount + onlineAnomalyCount;

      // 4. Compliance Score
      // A node is compliant if it is ONLINE and has no active anomalies.
      // Every offline node contributes 0% compliance.
      // Every online node contributes its quality (successRate). If no health score is recorded, it defaults to 1.0 (100%).
      const healthScoreMap = new Map<string, number>();
      healthScores.forEach((h) => {
        healthScoreMap.set(h.nodeId, h.successRate);
      });

      let totalComplianceSum = 0;
      allNodes.forEach((node) => {
        if (node.status === 'ONLINE') {
          const successRate = healthScoreMap.get(node.id) ?? 1.0;
          totalComplianceSum += successRate;
        } else {
          // offline nodes contribute 0% compliant
          totalComplianceSum += 0;
        }
      });

      const complianceScore = totalNodes > 0 ? (totalComplianceSum / totalNodes) * 100 : 0;

      return {
        activeConstraints,
        policyViolations,
        complianceScore: Math.round(complianceScore * 10) / 10,
        totalNodes,
        onlineNodes,
      };
    },
  );
}

