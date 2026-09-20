/**
 * Edge Node Management Routes
 *
 * What it does: Exposes API endpoints for managing the registration, state, and metrics of compute nodes.
 * Handlers:
 * - GET / — Lists and paginates registered edge/cloud nodes with filtering.
 * - GET /:id — Retrieves full node details, including currently running tasks and metric history.
 * - POST / — Registers a new edge node (includes SSRF validation on the IP address).
 * - PATCH /:id — Updates static properties of a node (e.g., location, capacity limits, costs).
 * - DELETE /:id — Deregisters a node, ensuring it has no active tasks.
 * - POST /:id/heartbeat — Receives resource usage heartbeats from agents, saving them to NodeMetric history.
 * - GET /:id/metrics — Retrieves time-series historical metrics for charting.
 * - POST /:id/maintenance — Toggles node maintenance state.
 * - POST /:id/drain — Drains a node (gracefully stops scheduling new tasks on it).
 * - POST /:id/offline — Manually forces a node's status to OFFLINE.
 * - GET /:id/scheduling-history — Returns recent scheduling decisions targeting the node.
 */
import {
  Permissions,
  v1NodeContracts,
  validateIpAddress,
} from '@edgecloud/shared-kernel';
import type { EdgeNode } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TenantId } from '../types/fastify.js';

import { idParamSchema } from '../schemas';
import { zodToFastifySchema } from '../utils/zod-schema';
import {
  CertificateAuthorityManager,
  CertificateRotationService,
  AgentCertificateGenerator,
} from '../services/mtls-authentication.js';

const NodeStatus = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  DEGRADED: 'DEGRADED',
  MAINTENANCE: 'MAINTENANCE',
} as const;

/**
 * Transform flat Prisma node model to versioned API response schema
 */
function transformNode(node: EdgeNode & { _count?: { tasks: number } }) {
  if (!node) {
    return null;
  }

  const {
    cpuCores,
    memoryGB,
    storageGB,
    cpuUsage,
    memoryUsage,
    tasksRunning,
    load,
    ...rest
  } = node as any;

  // Map to NodeV1ResponseSchema load format
  const nodeLoad = {
    cpuUsage:
      typeof cpuUsage === 'number'
        ? cpuUsage
        : typeof load === 'number'
          ? load
          : 0,
    memoryUsage: typeof memoryUsage === 'number' ? memoryUsage : 0,
    activeTasks:
      typeof tasksRunning === 'number'
        ? tasksRunning
        : typeof load === 'number'
          ? load
          : 0,
  };

  return {
    ...rest,
    specs: {
      cpuCores: cpuCores || 0,
      memoryGB: memoryGB || 0,
      storageGB: storageGB || 0,
    },
    load: nodeLoad,
    // Ensure status is uppercase as per schema
    status: (node.status || 'OFFLINE').toUpperCase(),
    lastHeartbeat: (
      node.lastHeartbeat ||
      node.createdAt ||
      new Date()
    ).toISOString(),
    taskCount: node._count?.tasks || 0,
  };
}

export default async function nodeRoutes(fastify: FastifyInstance) {
  // List nodes
  fastify.get<{ Querystring: v1NodeContracts.NodeQueryV1 }>(
    '/',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.NODE_READ),
      ],
      schema: {
        querystring: zodToFastifySchema(v1NodeContracts.NodeQueryV1Schema),
        tags: ['nodes'],
        summary: 'List edge nodes',
        response: {
          200: {
            type: 'object',
            properties: {
              data: {
                type: 'array',
                items: zodToFastifySchema(v1NodeContracts.NodeV1ResponseSchema),
              },
              pagination: {
                type: 'object',
                properties: {
                  page: { type: 'number' },
                  limit: { type: 'number' },
                  total: { type: 'number' },
                  totalPages: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: v1NodeContracts.NodeQueryV1 }>,
    ) => {
      const { region, status, page, limit, sortBy, sortOrder } = request.query;

      const where: any = {
        ...(region && { region }),
        ...(status && {
          status: status,
        }),
      };

      const [nodes, total] = await Promise.all([
        request.tPrisma.edgeNode.findMany({
          where,
          orderBy: { [sortBy]: sortOrder },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            _count: { select: { tasks: true } },
          },
        }),
        request.tPrisma.edgeNode.count({ where }),
      ]);

      return {
        data: nodes.map(transformNode),
        pagination: {
          page,
          limit,
          total,
          totalPages: total > 0 ? Math.ceil(total / limit) : 0,
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
      };
    },
  );

  // Get node by ID
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.NODE_READ),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['nodes'],
        summary: 'Get node by ID',
        response: {
          200: zodToFastifySchema(v1NodeContracts.NodeV1ResponseSchema),
          404: {
            $ref: 'ErrorSchema#',
          },
        },
      },
    },
    async (request, reply) => {
      const node = await request.tPrisma.edgeNode.findFirst({
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
        return reply.status(404).send({
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: 'Node not found',
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      return transformNode(node);
    },
  );

  // Create node
  fastify.post<{ Body: v1NodeContracts.RegisterNodeV1 }>(
    '/',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.NODE_REGISTER),
      ],
      schema: {
        body: zodToFastifySchema(v1NodeContracts.RegisterNodeV1Schema),
        tags: ['nodes'],
        summary: 'Register a new edge node',
        response: {
          201: zodToFastifySchema(v1NodeContracts.NodeV1ResponseSchema),
          409: {
            $ref: 'ErrorSchema#',
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: v1NodeContracts.RegisterNodeV1 }>,
      reply,
    ) => {
      const data = request.body;

      // SSRF Protection for IP address
      const validation = validateIpAddress(data.ipAddress);
      if (!validation.safe) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid IP address: ${validation.reason}`,
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Check for duplicate name within the same tenant
      const existing = await request.tPrisma.edgeNode.findFirst({
        where: {
          name: data.name,
        },
      });

      if (existing) {
        return reply.status(409).send({
          error: {
            code: 'RESOURCE_CONFLICT',
            message: 'Node with this name already exists in your tenant',
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      const node = await request.tPrisma.edgeNode.create({
        data: {
          name: data.name,
          location: data.location,
          region: data.region,
          ipAddress: data.ipAddress,
          port: data.port,
          cpuCores: data.cpuCores,
          memoryGB: data.memoryGB,
          storageGB: data.storageGB,
          gpuModel: data.gpuModel ?? null,
          gpuMemoryMb: data.gpuMemoryMb ?? null,
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
          tenantId: request.user!.tenantId!,
        },
      });

      // Audit log
      await request.tPrisma.auditLog.create({
        data: {
          userId: request.user!.id,
          tenantId: request.user!.tenantId!,
          action: 'node.created',
          entityType: 'node',
          entityId: node.id,
          details: { name: node.name, region: node.region } as any,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
      });

      return reply.status(201).send(transformNode(node));
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
        fastify.requirePermission(Permissions.NODE_REGISTER),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        body: zodToFastifySchema(v1NodeContracts.UpdateNodeV1Schema),
        tags: ['nodes'],
        summary: 'Update node configuration',
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const data = request.body;

      const existingNode = await fastify.prisma.edgeNode.findFirst({
        where: { id, tenantId: request.user!.tenantId! },
      });

      if (!existingNode) {
        return reply.status(404).send({
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: 'Node not found',
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      const node = await request.tPrisma.edgeNode.update({
        where: { id },
        data: data as any,
      });

      // Audit log
      await request.tPrisma.auditLog.create({
        data: {
          userId: request.user!.id,
          tenantId: request.user!.tenantId!,
          action: 'node.updated',
          entityType: 'node',
          entityId: node.id,
          details: { changes: data } as any,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
      });

      return transformNode(node);
    },
  );

  // Delete node
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.NODE_REGISTER),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['nodes'],
        summary: 'Deregister an edge node',
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      // Check for running tasks
      const runningTasks = await request.tPrisma.task.count({
        where: { nodeId: id, status: 'RUNNING' },
      });

      if (runningTasks > 0) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Cannot delete node with running tasks',
            details: { runningTasks } as any,
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      const existingNode = await fastify.prisma.edgeNode.findFirst({
        where: { id, tenantId: request.user!.tenantId! },
      });

      if (!existingNode) {
        return reply.status(404).send({
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: 'Node not found',
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      await request.tPrisma.edgeNode.delete({
        where: { id },
      });

      // Audit log
      await request.tPrisma.auditLog.create({
        data: {
          userId: request.user!.id,
          tenantId: request.user!.tenantId!,
          action: 'node.deleted',
          entityType: 'node',
          entityId: id,
          details: {},
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
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
      gpuModel?: string | null;
      gpuMemoryMb?: number | null;
      gpuUtilization?: number | null;
    };
  }>(
    '/:id/heartbeat',
    {
      preHandler: [fastify.authenticate],
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
            gpuModel: { type: 'string', nullable: true },
            gpuMemoryMb: { type: 'integer', nullable: true },
            gpuUtilization: { type: 'number', nullable: true },
          },
          required: ['cpuUsage', 'memoryUsage'],
        },
        tags: ['nodes'],
        summary: 'Receive heartbeat from edge agent',
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const metrics = (request as any).body;

      // Verify node belongs to user's tenant
      const node = await request.tPrisma.edgeNode.findFirst({
        where: { id },
      });

      if (!node) {
        return reply.status(404).send({
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: 'Node not found or access denied',
            requestId: request.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      const previousStatus = node.status;

      await request.tPrisma.edgeNode.update({
        where: { id },
        data: {
          cpuUsage: metrics.cpuUsage,
          memoryUsage: metrics.memoryUsage,
          storageUsage: metrics.storageUsage ?? 0,
          latency: metrics.latency ?? 0,
          tasksRunning: metrics.tasksRunning ?? 0,
          ...(metrics.gpuModel !== undefined && { gpuModel: metrics.gpuModel }),
          ...(metrics.gpuMemoryMb !== undefined && {
            gpuMemoryMb: metrics.gpuMemoryMb,
          }),
          lastHeartbeat: new Date(),
          status: 'ONLINE',
        },
      });

      // Auto-resolve open heartbeat-timeout alerts when node comes back online
      if (previousStatus !== 'ONLINE' && request.tPrisma.alert) {
        await request.tPrisma.alert.updateMany({
          where: {
            ruleId: 'heartbeat-timeout',
            entityId: id,
            acknowledged: false,
          },
          data: {
            acknowledged: true,
            acknowledgedAt: new Date(),
          },
        });

        // Emit system log: node came back online
        await request.tPrisma.auditLog
          .create({
            data: {
              tenantId: node.tenantId,
              action: 'node.online',
              entityType: 'node',
              entityId: id,
              details: {
                nodeName: node.name,
                previousStatus,
                reason: 'heartbeat_received',
              } as any,
            },
          })
          .catch(() => {}); // Non-critical — don't fail the heartbeat
      }

      // Store metrics
      await request.tPrisma.nodeMetric.create({
        data: {
          nodeId: id,
          tenantId: node.tenantId,
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
      fastify.wsManager.broadcastToTenant(
        node.tenantId as TenantId,
        'node:heartbeat',
        {
          nodeId: id,
          metrics,
          timestamp: new Date().toISOString(),
        },
      );

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
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.NODE_READ),
      ],
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

      const metrics = await request.tPrisma.nodeMetric.findMany({
        where: {
          nodeId: id,
          ...(from && { timestamp: { gte: new Date(from) } }),
          ...(to && { timestamp: { lte: new Date(to) } }),
        },
        orderBy: { timestamp: 'desc' },
        take: limit,
      });

      return {
        data: metrics,
        pagination: {
          page: 1,
          limit: metrics.length || 50,
          total: metrics.length,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
    },
  );

  // Set maintenance mode
  fastify.post<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/:id/maintenance',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.NODE_DRAIN),
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

      const node = await request.tPrisma.edgeNode.update({
        where: { id },
        data: {
          isMaintenanceMode: enabled,
          status: enabled ? NodeStatus.MAINTENANCE : NodeStatus.ONLINE,
        },
      });

      // Audit log
      await request.tPrisma.auditLog.create({
        data: {
          userId: request.user!.id,
          tenantId: request.user!.tenantId!,
          action: enabled
            ? 'node.maintenance_enabled'
            : 'node.maintenance_disabled',
          entityType: 'node',
          entityId: id,
          details: {},
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
      });

      return node;
    },
  );

  // Drain node (stop accepting new tasks)
  fastify.post<{ Params: { id: string } }>(
    '/:id/drain',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.NODE_DRAIN),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['nodes'],
        summary: 'Start draining a node (stop accepting new tasks)',
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const { id } = request.params;

      await request.tPrisma.edgeNode.update({
        where: { id },
        data: {
          isMaintenanceMode: true,
          status: NodeStatus.MAINTENANCE, // For now, we use MAINTENANCE as the underlying status
        },
      });

      // Audit log
      await request.tPrisma.auditLog.create({
        data: {
          userId: request.user!.id,
          tenantId: request.user!.tenantId!,
          action: 'node.drain_started',
          entityType: 'node',
          entityId: id,
          details: {} as any,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
      });

      return { success: true, message: 'Node is now draining' };
    },
  );

  // Force node offline
  fastify.post<{ Params: { id: string } }>(
    '/:id/offline',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.NODE_DRAIN),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['nodes'],
        summary: 'Force a node to OFFLINE status',
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const { id } = request.params;

      await request.tPrisma.edgeNode.update({
        where: { id },
        data: {
          status: NodeStatus.OFFLINE,
        },
      });

      // Audit log
      await request.tPrisma.auditLog.create({
        data: {
          userId: request.user!.id,
          tenantId: request.user!.tenantId!,
          action: 'node.forced_offline',
          entityType: 'node',
          entityId: id,
          details: {},
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
      });

      return { success: true, message: 'Node forced offline' };
    },
  );

  // Get scheduling history for a node
  fastify.get<{ Params: { id: string }; Querystring: { days?: number } }>(
    '/:id/scheduling-history',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.NODE_READ),
      ],
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
    async (request, _reply) => {
      const { id } = request.params;
      const { days = 7 } = request.query;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const history = await request.tPrisma.schedulingDecision.findMany({
        where: {
          selectedNodeId: id,
          timestamp: { gte: startDate },
        },
        orderBy: { timestamp: 'desc' },
        take: 1000,
      });

      return {
        data: history,
        pagination: {
          page: 1,
          limit: history.length || 50,
          total: history.length,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
    },
  );

  // POST /v2/nodes/:id/rotate-certificate
  fastify.post<{ Params: { id: string } }>(
    '/:id/rotate-certificate',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.NODE_REGISTER),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['nodes'],
        summary: 'Rotate mTLS certificate for a node (Administrative)',
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              certificatePem: { type: 'string' },
              serialNumber: { type: 'string' },
              expiresAt: { type: 'string' },
              privateKey: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const node = await request.tPrisma.edgeNode.findUnique({
        where: { id },
      });
      if (!node) {
        return reply.status(404).send({ error: 'Node not found' });
      }

      // Find or create active certificate for the node to get current serial
      let activeCert = await request.tPrisma.nodeCertificate.findFirst({
        where: { nodeId: id, isActive: true },
      });

      if (!activeCert) {
        const now = new Date();
        const expiresAt = new Date(now);
        expiresAt.setDate(expiresAt.getDate() + 365);
        activeCert = await request.tPrisma.nodeCertificate.create({
          data: {
            nodeId: id,
            serialNumber: `INIT-${id}`,
            certificatePem: 'INITIAL_PEM_PLACEHOLDER',
            publicKeyPem: 'INITIAL_PUBLIC_KEY_PLACEHOLDER',
            issuedAt: now,
            expiresAt,
            isActive: true,
          },
        });
      }

      // Generate a new keypair and CSR on behalf of the node (administrative shortcut)
      const { privateKey, csr } =
        await AgentCertificateGenerator.generateKeyPairAndCSR(
          id,
          node.region || 'us-east-1',
        );

      // Instantiate CertificateAuthorityManager and CertificateRotationService
      const caManager = new CertificateAuthorityManager(
        request.tPrisma as any,
        fastify.log,
      );
      await caManager.initialize();

      const rotationService = new CertificateRotationService(
        caManager,
        request.tPrisma as any,
        fastify.log,
      );

      // Perform rotation
      const result = await rotationService.rotateCertificate(
        id,
        csr,
        activeCert.serialNumber,
      );

      // Create audit log
      await request.tPrisma.auditLog.create({
        data: {
          userId: request.user!.id,
          tenantId: request.user!.tenantId!,
          action: 'node.certificate_rotated',
          entityType: 'node',
          entityId: id,
          details: { serialNumber: result.newSerialNumber } as any,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
      });

      return {
        success: true,
        message: 'Node certificate rotated successfully',
        certificatePem: result.newCertificate,
        serialNumber: result.newSerialNumber,
        expiresAt: result.expiresAt.toISOString(),
        privateKey,
      };
    },
  );
}
