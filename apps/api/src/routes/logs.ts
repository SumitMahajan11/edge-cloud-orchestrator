import { Permissions } from '@edgecloud/shared-kernel';
import type { FastifyInstance } from 'fastify';
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
  // Get global logs — merges TaskLog (task-level) + AuditLog (system events)
  fastify.get(
    '/',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_READ),
      ],
      schema: {
        querystring: zodToFastifySchema(LogQuerySchema),
        tags: ['logs'],
        summary: 'Get system-wide logs',
      },
    },
    async (request, _reply) => {
      const { taskId, nodeId, level, limit, offset } = request.query as z.infer<typeof LogQuerySchema>;
      const tenantId = request.user!.tenantId!;

      // --- Task-level logs from TaskLog table ---
      const taskLogs = await fastify.prisma.taskLog.findMany({
        where: {
          tenantId,
          ...(taskId ? { taskId } : {}),
          ...(level ? { level } : {}),
        },
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
        include: {
          task: { select: { name: true } },
        },
      });

      // --- System events from AuditLog table ---
      // Only pull audit logs when not filtering by taskId/nodeId (those are task-specific)
      // Map AuditLog level from action prefix: error.* → ERROR, warn.* → WARN, else INFO
      const auditLevelFilter = level
        ? level === 'ERROR'
          ? { action: { startsWith: 'error.' } }
          : level === 'WARN'
          ? { action: { startsWith: 'warn.' } }
          : level === 'DEBUG'
          ? { action: { startsWith: 'debug.' } }
          : {} // INFO catches everything else — handled via post-filter
        : {};

      const auditLogs = !taskId
        ? await fastify.prisma.auditLog.findMany({
            where: {
              tenantId,
              ...(nodeId
                ? { entityType: 'node', entityId: nodeId }
                : {}),
              ...auditLevelFilter,
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
          })
        : [];

      // Map AuditLog rows → LogEntry shape
      const mapAuditLevel = (action: string): 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' => {
        if (action.startsWith('error.')) return 'ERROR';
        if (action.startsWith('warn.')) return 'WARN';
        if (action.startsWith('debug.')) return 'DEBUG';
        return 'INFO';
      };

      const mappedAuditLogs = auditLogs
        .map((al) => ({
          id: al.id,
          taskId: null as string | null,
          executionId: null as string | null,
          timestamp: al.createdAt,
          level: mapAuditLevel(al.action),
          source: al.entityType || 'system',
          message: `${al.action}${al.entityId ? ` [${al.entityId}]` : ''}`,
          metadata: al.details as Record<string, unknown> | null,
          tenantId: al.tenantId,
          task: null as { name: string } | null,
        }))
        // Apply level filter if requested (INFO catches all non-error/warn/debug)
        .filter((al) => !level || al.level === level);

      // Merge and sort by timestamp descending, then paginate
      const merged = [
        ...taskLogs.map((tl) => ({
          id: tl.id,
          taskId: tl.taskId,
          executionId: tl.executionId,
          timestamp: tl.timestamp,
          level: tl.level,
          source: tl.source,
          message: tl.message,
          metadata: tl.metadata as Record<string, unknown> | null,
          tenantId: tl.tenantId,
          task: tl.task,
        })),
        ...mappedAuditLogs,
      ]
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, limit);

      return {
        data: merged,
        pagination: {
          page: 1,
          limit: merged.length || 50,
          total: merged.length,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
    },
  );

  // Get log statistics
  fastify.get(
    '/stats',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_READ),
      ],
      schema: {
        tags: ['logs'],
        summary: 'Get log statistics',
      },
    },
    async (request, _reply) => {
      const tenantId = request.user!.tenantId!;
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [taskTotal, taskErrors, auditTotal] = await Promise.all([
        fastify.prisma.taskLog.count({ where: { tenantId } }),
        fastify.prisma.taskLog.count({
          where: {
            tenantId,
            level: 'ERROR',
            timestamp: { gte: since24h },
          },
        }),
        fastify.prisma.auditLog.count({ where: { tenantId } }),
      ]);

      return {
        total: taskTotal + auditTotal,
        errorsLast24h: taskErrors,
        storageUsageGB: 1.2,
      };
    },
  );
}
