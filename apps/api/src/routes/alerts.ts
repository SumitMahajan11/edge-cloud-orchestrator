import { Permissions } from '@edgecloud/shared-kernel';
import type { FastifyInstance } from 'fastify';

import { getAlertingService } from '../services/alerting-service.js';

export default async function alertRoutes(fastify: FastifyInstance) {
  // Get all alerts for tenant
  fastify.get(
    '/',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.ALERT_READ),
      ],
      schema: {
        tags: ['alerts'],
        summary: 'Get active alerts for tenant',
        response: {
          200: {
            type: 'object',
            properties: {
              alerts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    severity: {
                      type: 'string',
                      enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
                    },
                    title: { type: 'string' },
                    description: { type: 'string' },
                    source: { type: 'string' },
                    firedAt: { type: 'string' },
                    acknowledgedAt: { type: 'string', nullable: true },
                    resolvedAt: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const tenantId = request.user.tenantId!;
      const dbAlerts = await fastify.prisma.alert.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      // Map DB Alert model to the API response shape
      const alerts = dbAlerts.map((a) => ({
        id: a.id,
        severity: a.severity.toUpperCase() as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
        title: a.message,
        description: a.message,
        source: a.entityType ? `${a.entityType}:${a.entityId}` : 'system',
        firedAt: a.createdAt.toISOString(),
        acknowledgedAt: (a as any).acknowledgedAt?.toISOString() ?? null,
        resolvedAt: null,
      }));
      return { alerts };
    },
  );

  // Acknowledge an alert
  fastify.post<{
    Params: { id: string };
  }>(
    '/:id/acknowledge',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.ALERT_MANAGE),
      ],
      schema: {
        tags: ['alerts'],
        summary: 'Acknowledge an alert',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const tenantId = request.user.tenantId!;

      const alert = await fastify.prisma.alert.findFirst({
        where: { id, tenantId },
      });

      if (!alert) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Alert not found or access denied',
            requestId: request.id,
          },
        });
      }

      await fastify.prisma.alert.update({
        where: { id },
        data: { acknowledged: true, acknowledgedAt: new Date() },
      });

      return { success: true };
    },
  );

  // Send test alert (admin only)
  fastify.post<{
    Body: {
      severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
      title: string;
      description: string;
    };
  }>(
    '/test',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.ALERT_MANAGE),
      ],
      schema: {
        tags: ['alerts'],
        summary: 'Send test alert',
        body: {
          type: 'object',
          required: ['severity', 'title', 'description'],
          properties: {
            severity: {
              type: 'string',
              enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
            },
            title: { type: 'string' },
            description: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const alerting = getAlertingService();
      if (!alerting) {
        return reply.status(503).send({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Alerting service unavailable',
            requestId: request.id,
          },
        });
      }

      let mappedSeverity: 'critical' | 'warning' | 'info' = 'info';
      if (request.body.severity === 'CRITICAL') {
        mappedSeverity = 'critical';
      } else if (
        request.body.severity === 'HIGH' ||
        request.body.severity === 'MEDIUM'
      ) {
        mappedSeverity = 'warning';
      }

      await alerting.alert(
        mappedSeverity,
        request.body.title,
        request.body.description,
        'manual-test',
        request.user.tenantId!,
      );

      return { success: true };
    },
  );
}
