import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  createWebhookSchema,
  idParamSchema,
  updateWebhookSchema,
} from '../schemas';
import { zodToFastifySchema } from '../utils/zod-schema';

export default async function webhookRoutes(fastify: FastifyInstance) {
  // List webhooks
  fastify.get(
    '/',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['webhooks'],
        summary: 'List webhooks',
      },
    },
    async (request, _reply) => {
      const webhooks = await (fastify.prisma as any).webhook.findMany({
        where: { tenantId: request.user!.tenantId! },
        include: {
          _count: { select: { deliveries: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return webhooks;
    },
  );

  // Get webhook stats
  fastify.get(
    '/stats',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['webhooks'],
        summary: 'Get webhook delivery statistics',
        response: {
          200: {
            type: 'object',
            properties: {
              total: { type: 'number' },
              active: { type: 'number' },
              failedLast24h: { type: 'number' },
              avgLatency: { type: 'number' },
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const tenantId = request.user!.tenantId!;
      
      const [total, active, failedLast24h] = await Promise.all([
        (fastify.prisma as any).webhook.count({ where: { tenantId } }),
        (fastify.prisma as any).webhook.count({ where: { tenantId, enabled: true } }),
        (fastify.prisma as any).webhookDelivery.count({ 
          where: { 
            tenantId, 
            status: 'FAILED',
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          } 
        }),
      ]);

      return {
        total,
        active,
        failedLast24h,
        avgLatency: 150, // Mocked latency
      };
    },
  );

  // Create webhook
  fastify.post<{ Body: z.infer<typeof createWebhookSchema> }>(
    '/',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
      schema: {
        body: zodToFastifySchema(createWebhookSchema),
        tags: ['webhooks'],
        summary: 'Create a webhook',
      },
    },
    async (request, reply) => {
      const { name, url, events, secret, enabled } = request.body;

      const webhook = await (fastify.prisma as any).webhook.create({
        data: {
          name,
          url,
          events,
          secret: secret || crypto.randomBytes(32).toString('hex'),
          enabled,
          tenantId: request.user!.tenantId!,
        },
      });

      return reply.status(201).send(webhook);
    },
  );

  // Update webhook
  fastify.patch<{
    Params: { id: string };
    Body: z.infer<typeof updateWebhookSchema>;
  }>(
    '/:id',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        body: zodToFastifySchema(updateWebhookSchema),
        tags: ['webhooks'],
        summary: 'Update a webhook',
      },
    },
    async (request, _reply) => {
      const { id } = request.params;
      const data = request.body;

      const webhook = await (fastify.prisma as any).webhook.update({
        where: { id, tenantId: request.user!.tenantId! },
        data: data as any,
      });

      return webhook;
    },
  );

  // Delete webhook
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['webhooks'],
        summary: 'Delete a webhook',
      },
    },
    async (request, _reply) => {
      await (fastify.prisma as any).webhook.delete({ where: { id: request.params.id, tenantId: request.user!.tenantId! } });
      return { success: true };
    },
  );

  // Get deliveries
  fastify.get<{ Params: { id: string }; Querystring: { limit?: number } }>(
    '/:id/deliveries',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'number', default: 50 },
          },
        },
        tags: ['webhooks'],
        summary: 'Get webhook delivery history',
      },
    },
    async (request, _reply) => {
      const { id } = request.params;
      const { limit = 50 } = request.query;

      const deliveries = await (fastify.prisma as any).webhookDelivery.findMany({
        where: { webhookId: id, webhook: { tenantId: request.user!.tenantId! } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return deliveries;
    },
  );

  // Redeliver
  fastify.post<{ Params: { id: string; deliveryId: string } }>(
    '/:id/redeliver/:deliveryId',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
      schema: {
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            deliveryId: { type: 'string' },
          },
          required: ['id', 'deliveryId'],
        },
        tags: ['webhooks'],
        summary: 'Redeliver a webhook',
      },
    },
    async (request, reply) => {
      const { id, deliveryId } = request.params;

      const delivery = await (fastify.prisma as any).webhookDelivery.findFirst({
        where: { id: deliveryId, webhookId: id, webhook: { tenantId: request.user!.tenantId! } },
        include: { webhook: true },
      });

      if (!delivery) {
        return reply.status(404).send({ error: 'Delivery not found' });
      }

      // Queue redelivery via Redis
      await fastify.redis.lpush(
        'queue:webhook:redeliveries',
        JSON.stringify({ webhookId: id, deliveryId }),
      );

      return { success: true, message: 'Redelivery queued' };
    },
  );

  // Test webhook
  fastify.post<{ Params: { id: string } }>(
    '/:id/test',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['webhooks'],
        summary: 'Send a test event to the webhook',
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              deliveryId: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const webhook = await (fastify.prisma as any).webhook.findUnique({
        where: { id, tenantId: request.user!.tenantId! },
      });

      if (!webhook) {
        return reply.status(404).send({ error: 'Webhook not found' });
      }

      // Create a test delivery record
      const delivery = await (fastify.prisma as any).webhookDelivery.create({
        data: {
          webhookId: id,
          event: 'webhook.test',
          payload: { test: true, timestamp: new Date().toISOString() },
          status: 'PENDING',
          tenantId: request.user!.tenantId!,
        },
      });

      // Queue delivery
      await fastify.redis.lpush(
        'queue:webhook:deliveries',
        JSON.stringify({ webhookId: id, deliveryId: delivery.id }),
      );

      return { success: true, deliveryId: delivery.id };
    },
  );

  // Retry delivery (convenience endpoint matching frontend expectation)
  fastify.post<{ Params: { id: string } }>(
    '/deliveries/:id/retry',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['webhooks'],
        summary: 'Retry a failed webhook delivery',
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
    async (request, reply) => {
      const { id } = request.params; // This id is the deliveryId

      const delivery = await (fastify.prisma as any).webhookDelivery.findFirst({
        where: { id, tenantId: request.user!.tenantId! },
      });

      if (!delivery) {
        return reply.status(404).send({ error: 'Delivery not found' });
      }

      // Queue redelivery
      await fastify.redis.lpush(
        'queue:webhook:redeliveries',
        JSON.stringify({ webhookId: delivery.webhookId, deliveryId: id }),
      );

      return { success: true, message: 'Retry queued' };
    },
  );
}

