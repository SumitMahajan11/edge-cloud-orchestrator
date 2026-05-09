import { FastifyInstance } from 'fastify';

import { getAlertingService } from '../services/alerting-service.js';

export default async function alertRoutes(fastify: FastifyInstance) {
  // Get alert history
  fastify.get<{
    Querystring: { severity?: 'critical' | 'warning' | 'info' };
  }>(
    '/',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['alerts'],
        summary: 'Get alert history',
        querystring: {
          type: 'object',
          properties: {
            severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
          },
        },
      },
    },
    async (request, _reply) => {
      const alerting = getAlertingService();
      if (!alerting) {
        return { alerts: [] };
      }
      return { alerts: alerting.getAlertHistory(request.user!.tenantId!, request.query.severity) };
    },
  );

  // Clear alert history (admin only)
  fastify.delete(
    '/',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['alerts'],
        summary: 'Clear alert history',
      },
    },
    async (request, reply) => {
      const alerting = getAlertingService();
      if (!alerting) {
        return reply.status(500).send({ 
          code: 'SERVICE_UNAVAILABLE', 
          message: 'Alerting not initialized' 
        });
      }
      alerting.clearHistory(request.user!.tenantId!);
      return { success: true, message: 'Alert history cleared' };
    },
  );

  // Test alert (admin only)
  fastify.post<{
    Body: {
      severity: 'critical' | 'warning' | 'info';
      title: string;
      message: string;
    };
  }>(
    '/test',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['alerts'],
        summary: 'Send test alert',
        body: {
          type: 'object',
          required: ['severity', 'title', 'message'],
          properties: {
            severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
            title: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const alerting = getAlertingService();
      if (!alerting) {
        return reply.status(500).send({ 
          code: 'SERVICE_UNAVAILABLE', 
          message: 'Alerting not initialized' 
        });
      }

      await alerting.alert(
        request.body.severity,
        request.body.title,
        request.body.message,
        'test',
        request.user!.tenantId!,
      );

      return { success: true, message: 'Test alert sent' };
    },
  );
}

