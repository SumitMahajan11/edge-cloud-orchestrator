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
    async (request) => {
      const alerting = getAlertingService();
      if (!alerting) {
        return { alerts: [] };
      }
      return { alerts: alerting.getAlertHistory(request.query.severity) };
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
    async () => {
      const alerting = getAlertingService();
      if (!alerting) {
        return { success: false, message: 'Alerting not initialized' };
      }
      alerting.clearHistory();
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
    async (request) => {
      const alerting = getAlertingService();
      if (!alerting) {
        return { success: false, message: 'Alerting not initialized' };
      }

      await alerting.alert(
        request.body.severity,
        request.body.title,
        request.body.message,
        'test',
      );

      return { success: true, message: 'Test alert sent' };
    },
  );
}
