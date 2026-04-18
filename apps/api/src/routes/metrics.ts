import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { register } from '../services/metrics-service.js';

export default async function metricsRoutes(fastify: FastifyInstance) {
  // Helper to build system metrics response
  async function buildSystemMetrics() {
    const [
      totalNodes,
      onlineNodes,
      totalTasks,
      pendingTasks,
      runningTasks,
      completedTasks,
      failedTasks,
    ] = await Promise.all([
      fastify.prisma.edgeNode.count(),
      fastify.prisma.edgeNode.count({ where: { status: 'online' as any } }),
      fastify.prisma.task.count(),
      fastify.prisma.task.count({ where: { status: 'pending' as any } }),
      fastify.prisma.task.count({ where: { status: 'running' as any } }),
      fastify.prisma.task.count({ where: { status: 'completed' as any } }),
      fastify.prisma.task.count({ where: { status: 'failed' as any } }),
    ]);

    const avgLatency = await (fastify.prisma.edgeNode as any).aggregate({
      where: { status: 'online' },
      _avg: { latency: true },
    });

    const totalCost = await (fastify.prisma.costRecord as any).aggregate({
      _sum: { cost: true },
    });

    const offlineNodes = totalNodes - onlineNodes;
    const healthScore =
      totalNodes > 0 ? Math.round((onlineNodes / totalNodes) * 100) : 100;
    const completionRate =
      totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return {
      totalNodes,
      onlineNodes,
      offlineNodes,
      degradedNodes: 0,
      totalTasks,
      pendingTasks,
      runningTasks,
      completedTasks,
      failedTasks,
      avgLatency: avgLatency._avg?.latency || 0,
      totalCost: totalCost._sum?.cost || 0,
      edgeUtilization: onlineNodes > 0 ? Math.min(95, runningTasks * 10) : 0,
      cloudUtilization: 30,
      throughput: completedTasks,
      healthScore,
      completionRate,
      cpuHistory: [],
      taskDistribution: {
        edge: Math.round(totalTasks * 0.6),
        cloud: Math.round(totalTasks * 0.4),
      },
      costOverTime: [],
      timestamp: new Date().toISOString(),
    };
  }

  // /api/metrics/system
  fastify.get(
    '/system',
    {
      preHandler: [fastify.authenticate],
      schema: { tags: ['metrics'], summary: 'Get system metrics' },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      return buildSystemMetrics();
    },
  );

  // /api/metrics
  fastify.get(
    '/',
    {
      preHandler: [fastify.authenticate],
      schema: { tags: ['metrics'], summary: 'Get system metrics' },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      return buildSystemMetrics();
    },
  );

  // /api/metrics/requests
  fastify.get(
    '/requests',
    {
      preHandler: [fastify.authenticate],
      schema: { tags: ['metrics'], summary: 'Get request metrics' },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      return {
        date: new Date().toISOString().split('T')[0],
        total: 0,
        responseTime: 0,
        status2xx: 0,
        status4xx: 0,
        status5xx: 0,
      };
    },
  );

  // /api/metrics/nodes
  fastify.get(
    '/nodes',
    {
      preHandler: [fastify.authenticate],
      schema: { tags: ['metrics'], summary: 'Get node metrics summary' },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      const nodes = await fastify.prisma.edgeNode.findMany({
        where: { status: 'online' as any },
      });
      return { total: nodes.length, nodes };
    },
  );

  // Prometheus metrics endpoint - /api/metrics/prometheus
  fastify.get(
    '/prometheus',
    {
      schema: {
        tags: ['metrics'],
        summary: 'Get Prometheus metrics',
        description: 'Returns metrics in Prometheus exposition format',
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const metrics = await register.metrics();
      reply.header('Content-Type', register.contentType);
      return metrics;
    },
  );
}
