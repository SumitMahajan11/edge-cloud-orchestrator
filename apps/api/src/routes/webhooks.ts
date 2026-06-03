import crypto from 'crypto';
import { Permissions, validateWebhookUrl } from '@edgecloud/shared-kernel';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  createWebhookSchema,
  idParamSchema,
  updateWebhookSchema,
  webhooksDeliveriesQuerySchema,
  webhooksRedeliverParamSchema,
} from '../schemas';
import { zodToFastifySchema } from '../utils/zod-schema.js';

const isSqlite = process.env.DATABASE_URL?.startsWith('file:') || process.env.DATABASE_URL?.includes('.db');

function formatWebhook(webhook: any) {
  if (!webhook) return webhook;
  if (isSqlite && typeof webhook.events === 'string') {
    try {
      webhook.events = JSON.parse(webhook.events);
    } catch {
      webhook.events = webhook.events ? webhook.events.split(',') : [];
    }
  }
  return webhook;
}

export default async function webhookRoutes(fastify: FastifyInstance) {
  // List webhooks
  fastify.get(
    '/',
    {
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.WEBHOOK_READ)],
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

      return {
        data: isSqlite ? webhooks.map(formatWebhook) : webhooks,
        pagination: {
          page: 1,
          limit: webhooks.length || 50,
          total: webhooks.length,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        }
      };
    },
  );

  // Get webhook stats
  fastify.get(
    '/stats',
    {
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.WEBHOOK_READ)],
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
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.WEBHOOK_MANAGE)],
      schema: {
        body: zodToFastifySchema(createWebhookSchema),
        tags: ['webhooks'],
        summary: 'Create a webhook',
      },
    },
    async (request, reply) => {
      const { name, url, events, secret, enabled } = request.body;

      // SSRF Protection
      const { safe, reason } = await validateWebhookUrl(url);
      if (!safe) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_WEBHOOK_URL',
            message: `Webhook URL rejected: ${reason}`,
            requestId: request.id,
          }
        });
      }

      const webhook = await (fastify.prisma as any).webhook.create({
        data: {
          name,
          url,
          events: isSqlite ? JSON.stringify(events) : events,
          secret: secret || crypto.randomBytes(32).toString('hex'),
          enabled,
          tenantId: request.user!.tenantId!,
        },
      });

      return reply.status(201).send(isSqlite ? formatWebhook(webhook) : webhook);
    },
  );

  // Update webhook
  fastify.patch<{
    Params: { id: string };
    Body: z.infer<typeof updateWebhookSchema>;
  }>(
    '/:id',
    {
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.WEBHOOK_MANAGE)],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        body: zodToFastifySchema(updateWebhookSchema),
        tags: ['webhooks'],
        summary: 'Update a webhook',
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const data = request.body;

      // SSRF Protection if URL is being updated
      if (data.url) {
        const { safe, reason } = await validateWebhookUrl(data.url);
        if (!safe) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_WEBHOOK_URL',
              message: `Webhook URL rejected: ${reason}`,
              requestId: request.id,
            }
          });
        }
      }

      const updateData = { ...data };
      if (isSqlite && updateData.events && Array.isArray(updateData.events)) {
        updateData.events = JSON.stringify(updateData.events) as any;
      }

      const webhook = await (fastify.prisma as any).webhook.update({
        where: { id, tenantId: request.user!.tenantId! },
        data: updateData as any,
      });

      return isSqlite ? formatWebhook(webhook) : webhook;
    },
  );

  // Delete webhook
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.WEBHOOK_MANAGE)],
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
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.WEBHOOK_READ)],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        querystring: zodToFastifySchema(webhooksDeliveriesQuerySchema),
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

      return {
        data: deliveries,
        pagination: {
          page: 1,
          limit: deliveries.length || 50,
          total: deliveries.length,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        }
      };
    },
  );

  // Redeliver
  fastify.post<{ Params: { id: string; deliveryId: string } }>(
    '/:id/redeliver/:deliveryId',
    {
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.WEBHOOK_MANAGE)],
      schema: {
        params: zodToFastifySchema(webhooksRedeliverParamSchema),
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
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Delivery not found',
            requestId: request.id,
          }
        });
      }

      // Check idempotency for manual redelivery
      const idempotencyKey = `webhook:redeliver:${deliveryId}`;
      const result = await fastify.idempotencyService.checkAndRecord({
        idempotencyKey,
        resourceType: 'WebhookDelivery',
        resourceId: deliveryId,
        ttlMs: 3600000 // 1 hour
      });

      if (result.isDuplicate) {
        return reply.status(409).send({
          error: {
            code: 'CONFLICT',
            message: 'A redelivery for this record is already in progress or was recently completed.',
            requestId: request.id,
          }
        });
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
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.WEBHOOK_MANAGE)],
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
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Webhook not found',
            requestId: request.id,
          }
        });
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
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.WEBHOOK_MANAGE)],
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
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Delivery not found',
            requestId: request.id,
          }
        });
      }

      // Check idempotency for manual retry
      const idempotencyKey = `webhook:retry:${id}`;
      const result = await fastify.idempotencyService.checkAndRecord({
        idempotencyKey,
        resourceType: 'WebhookDelivery',
        resourceId: id,
        ttlMs: 3600000 // 1 hour
      });

      if (result.isDuplicate) {
        return reply.status(409).send({
          error: {
            code: 'CONFLICT',
            message: 'A retry for this delivery is already in progress or was recently completed.',
            requestId: request.id,
          }
        });
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

