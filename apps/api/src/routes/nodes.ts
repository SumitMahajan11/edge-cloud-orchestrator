import { FastifyInstance, FastifyRequest } from 'fastify';

import { v1NodeContracts } from '@edgecloud/shared-kernel';
import { idParamSchema } from '../schemas';
import { zodToFastifySchema } from '../utils/zod-schema';

const NodeStatus = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  DEGRADED: 'DEGRADED',
  MAINTENANCE: 'MAINTENANCE',
} as const;

const Role = {
  ADMIN: 'ADMIN',
  OPERATOR: 'OPERATOR',
  VIEWER: 'VIEWER',
} as const;

export default async function nodeRoutes(fastify: FastifyInstance) {
  // List nodes
  fastify.get<{ Querystring: v1NodeContracts.NodeQueryV1 }>(
    '/',
    {
      preHandler: [fastify.authenticate],
      schema: {
        querystring: zodToFastifySchema(v1NodeContracts.NodeQueryV1Schema),
        tags: ['nodes'],
        summary: 'List edge nodes',
      },
    },
    async (request: FastifyRequest<{ Querystring: v1NodeContracts.NodeQueryV1 }>, _reply) => {
      const { region, status, page, limit, sortBy, sortOrder } = request.query;

      const where = {
        ...(region && { region }),
        ...(status && {
          status: status as (typeof NodeStatus)[keyof typeof NodeStatus],
        }),
      };

      const [nodes, total] = await Promise.all([
        fastify.prisma.edgeNode.findMany({
          where,
          orderBy: { [sortBy]: sortOrder },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            _count: { select: { tasks: true } },
          },
        }),
        fastify.prisma.edgeNode.count({ where }),
      ]);

      return {
        data: nodes,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
  );

  // Get node by ID
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['nodes'],
        summary: 'Get node by ID',
      },
    },
    async (request, reply) => {
      const node = await fastify.prisma.edgeNode.findUnique({
        where: { id: request.params.id },
        include: {
          tasks: {
            where: { status: 'RUNNING' },
            select: { id: true, name: true, type: true, submittedAt: true },
          },
          metrics: {
            orderBy: { timestamp: 'desc' },
            take: 100,
          },
        },
      });

      if (!node) {
        return reply.status(404).send({ error: 'Node not found' });
      }

      return node;
    },
  );

  // Create node
  fastify.post<{ Body: v1NodeContracts.RegisterNodeV1 }>(
    '/',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(Role.ADMIN, Role.OPERATOR),
      ],
      schema: {
        body: zodToFastifySchema(v1NodeContracts.RegisterNodeV1Schema),
        tags: ['nodes'],
        summary: 'Register a new edge node',
      },
    },
    async (request: FastifyRequest<{ Body: v1NodeContracts.RegisterNodeV1 }>, reply) => {
      const data = request.body;

      // Check for duplicate name
      const existing = await fastify.prisma.edgeNode.findUnique({
        where: { name: data.name },
      });

      if (existing) {
        return reply
          .status(409)
          .send({ error: 'Node with this name already exists' });
      }

      const node = await fastify.prisma.edgeNode.create({
        data: {
          name: data.name,
          location: data.location,
          region: data.region,
          ipAddress: data.ipAddress,
          port: data.port,
          cpuCores: data.cpuCores,
          memoryGB: data.memoryGB,
          storageGB: data.storageGB,
          url: `http://${data.ipAddress}:${data.port}`,
          status: 'OFFLINE',
          ...(data.maxTasks !== undefined && { maxTasks: data.maxTasks }),
          ...(data.costPerHour !== undefined && {
            costPerHour: data.costPerHour,
          }),
          ...(data.bandwidthInMbps !== undefined && {
            bandwidthInMbps: data.bandwidthInMbps,
          }),
          ...(data.bandwidthOutMbps !== undefined && {
            bandwidthOutMbps: data.bandwidthOutMbps,
          }),
        },
      });

      // Audit log
      await fastify.prisma.auditLog.create({
        data: {
          userId: (request.user as any).id,
          action: 'node.created',
          entityType: 'node',
          entityId: node.id,
          details: { name: node.name, region: node.region },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      });

      return reply.status(201).send(node);
    },
  );

  // Update node
  fastify.patch<{
    Params: { id: string };
    Body: v1NodeContracts.UpdateNodeV1;
  }>(
    '/:id',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(Role.ADMIN, Role.OPERATOR),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        body: zodToFastifySchema(v1NodeContracts.UpdateNodeV1Schema),
        tags: ['nodes'],
        summary: 'Update node configuration',
      },
    },
    async (request, _reply) => {
      const { id } = request.params;
      const data = request.body;

      const node = await fastify.prisma.edgeNode.update({
        where: { id },
        data,
      });

      // Audit log
      await fastify.prisma.auditLog.create({
        data: {
          userId: (request.user as any).id,
          action: 'node.updated',
          entityType: 'node',
          entityId: node.id,
          details: { changes: data },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      });

      return node;
    },
  );

  // Delete node
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [fastify.authenticate, fastify.requireRole(Role.ADMIN)],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['nodes'],
        summary: 'Deregister an edge node',
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      // Check for running tasks
      const runningTasks = await fastify.prisma.task.count({
        where: { nodeId: id, status: 'RUNNING' },
      });

      if (runningTasks > 0) {
        return reply.status(400).send({
          error: 'Cannot delete node with running tasks',
          runningTasks,
        });
      }

      await fastify.prisma.edgeNode.delete({ where: { id } });

      // Audit log
      await fastify.prisma.auditLog.create({
        data: {
          userId: (request.user as any).id,
          action: 'node.deleted',
          entityType: 'node',
          entityId: id,
          details: {},
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      });

      return { success: true };
    },
  );

  // Node heartbeat (called by edge agent)
  fastify.post<{
    Params: { id: string };
    Body: {
      cpuUsage: number;
      memoryUsage: number;
      storageUsage?: number;
      latency?: number;
      tasksRunning?: number;
      networkIn?: number;
      networkOut?: number;
    };
  }>(
    '/:id/heartbeat',
    {
      schema: {
        params: zodToFastifySchema(idParamSchema),
        body: {
          type: 'object',
          properties: {
            cpuUsage: { type: 'number' },
            memoryUsage: { type: 'number' },
            storageUsage: { type: 'number' },
            latency: { type: 'number' },
            tasksRunning: { type: 'number' },
            networkIn: { type: 'number' },
            networkOut: { type: 'number' },
          },
          required: ['cpuUsage', 'memoryUsage'],
        },
        tags: ['nodes'],
        summary: 'Receive heartbeat from edge agent',
      },
    },
    async (request, _reply) => {
      const { id } = request.params;
      const metrics = request.body;

      // Verify node certificate (mTLS) - in production
      // For now, just update the node

      await fastify.prisma.edgeNode.update({
        where: { id },
        data: {
          cpuUsage: metrics.cpuUsage,
          memoryUsage: metrics.memoryUsage,
          storageUsage: metrics.storageUsage ?? 0,
          latency: metrics.latency ?? 0,
          tasksRunning: metrics.tasksRunning ?? 0,
          lastHeartbeat: new Date(),
          status: 'ONLINE',
        },
      });

      // Store metrics
      await fastify.prisma.nodeMetric.create({
        data: {
          nodeId: id,
          cpuUsage: metrics.cpuUsage,
          memoryUsage: metrics.memoryUsage,
          storageUsage: metrics.storageUsage ?? 0,
          latency: metrics.latency ?? 0,
          tasksRunning: metrics.tasksRunning ?? 0,
          networkIn: metrics.networkIn ?? 0,
          networkOut: metrics.networkOut ?? 0,
        },
      });

      // Publish to WebSocket subscribers
      fastify.wsManager.broadcast('node:heartbeat', {
        nodeId: id,
        metrics,
        timestamp: new Date().toISOString(),
      });

      return { success: true, timestamp: new Date().toISOString() };
    },
  );

  // Get node metrics
  fastify.get<{
    Params: { id: string };
    Querystring: { from?: string; to?: string; limit?: number };
  }>(
    '/:id/metrics',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        querystring: {
          type: 'object',
          properties: {
            from: { type: 'string', format: 'date-time' },
            to: { type: 'string', format: 'date-time' },
            limit: { type: 'number', default: 100 },
          },
        },
        tags: ['nodes'],
        summary: 'Get node metrics history',
      },
    },
    async (request, _reply) => {
      const { id } = request.params;
      const { from, to, limit = 100 } = request.query;

      const metrics = await fastify.prisma.nodeMetric.findMany({
        where: {
          nodeId: id,
          ...(from && { timestamp: { gte: new Date(from) } }),
          ...(to && { timestamp: { lte: new Date(to) } }),
        },
        orderBy: { timestamp: 'desc' },
        take: limit,
      });

      return metrics;
    },
  );

  // Set maintenance mode
  fastify.post<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/:id/maintenance',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(Role.ADMIN, Role.OPERATOR),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        body: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
          },
          required: ['enabled'],
        },
        tags: ['nodes'],
        summary: 'Enable/disable maintenance mode',
      },
    },
    async (request, _reply) => {
      const { id } = request.params;
      const { enabled } = request.body;

      const node = await fastify.prisma.edgeNode.update({
        where: { id },
        data: {
          isMaintenanceMode: enabled,
          status: enabled ? NodeStatus.MAINTENANCE : NodeStatus.ONLINE,
        },
      });

      // Audit log
      await fastify.prisma.auditLog.create({
        data: {
          userId: (request.user as any).id,
          action: enabled
            ? 'node.maintenance_enabled'
            : 'node.maintenance_disabled',
          entityType: 'node',
          entityId: id,
          details: {},
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      });

      return node;
    },
  );

  // Get scheduling history for a node
  fastify.get<{ Params: { id: string }; Querystring: { days?: number } }>(
    '/:id/scheduling-history',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        querystring: {
          type: 'object',
          properties: {
            days: { type: 'number', default: 7 },
          },
        },
        tags: ['nodes'],
        summary: 'Get scheduling history for a node',
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { days = 7 } = request.query;
      
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const history = await (fastify.prisma as any).schedulingDecision.findMany({
        where: {
          selectedNodeId: id,
          timestamp: { gte: startDate },
        },
        orderBy: { timestamp: 'desc' },
        take: 1000,
      });

      return history;
    },
  );
}
