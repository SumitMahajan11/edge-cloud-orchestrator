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
    async (_request, _reply) => {
      const webhooks = await fastify.prisma.webhook.findMany({
        include: {
          _count: { select: { deliveries: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return webhooks;
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

      const webhook = await fastify.prisma.webhook.create({
        data: {
          name,
          url,
          events,
          secret: secret || crypto.randomBytes(32).toString('hex'),
          enabled,
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

      const webhook = await fastify.prisma.webhook.update({
        where: { id },
        data,
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
      await fastify.prisma.webhook.delete({ where: { id: request.params.id } });
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

      const deliveries = await fastify.prisma.webhookDelivery.findMany({
        where: { webhookId: id },
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

      const delivery = await fastify.prisma.webhookDelivery.findFirst({
        where: { id: deliveryId, webhookId: id },
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
}
