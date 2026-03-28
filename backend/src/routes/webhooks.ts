import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { createWebhookSchema, updateWebhookSchema, idParamSchema } from '../schemas'
import { zodToFastifySchema } from '../utils/zod-schema'
import crypto from 'crypto'

export default async function webhookRoutes(fastify: FastifyInstance) {
  // List webhooks
  fastify.get('/', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['webhooks'],
      summary: 'List webhooks',
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const webhooks = await fastify.prisma.webhook.findMany({
      include: {
        _count: { select: { deliveries: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    
    return webhooks
  })
  
  // Create webhook
  fastify.post('/', {
    preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
    schema: {
      body: zodToFastifySchema(createWebhookSchema),
      tags: ['webhooks'],
      summary: 'Create a webhook',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof createWebhookSchema> }>, reply: FastifyReply) => {
    const { name, url, events, secret, enabled } = request.body
    
    const webhook = await fastify.prisma.webhook.create({
      data: {
        name,
        url,
        events,
        secret: secret || crypto.randomBytes(32).toString('hex'),
        enabled,
      },
    })
    
    return reply.status(201).send(webhook)
  })
  
  // Update webhook
  fastify.patch('/:id', {
    preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
    schema: {
      params: zodToFastifySchema(idParamSchema),
      body: zodToFastifySchema(updateWebhookSchema),
      tags: ['webhooks'],
      summary: 'Update a webhook',
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: z.infer<typeof updateWebhookSchema> }>, reply: FastifyReply) => {
    const { id } = request.params
    const data = request.body
    
    const webhook = await fastify.prisma.webhook.update({
      where: { id },
      data,
    })
    
    return webhook
  })
  
  // Delete webhook
  fastify.delete('/:id', {
    preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
    schema: {
      params: zodToFastifySchema(idParamSchema),
      tags: ['webhooks'],
      summary: 'Delete a webhook',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await fastify.prisma.webhook.delete({ where: { id: request.params.id } })
    return { success: true }
  })
  
  // Get deliveries
  fastify.get('/:id/deliveries', {
    preHandler: [fastify.authenticate],
    schema: {
      params: zodToFastifySchema(idParamSchema),
      tags: ['webhooks'],
      summary: 'Get webhook delivery history',
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Querystring: { limit?: number } }>, reply: FastifyReply) => {
    const { id } = request.params
    const { limit = 50 } = request.query
    
    const deliveries = await fastify.prisma.webhookDelivery.findMany({
      where: { webhookId: id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    
    return deliveries
  })
  
  // Redeliver
  fastify.post('/:id/redeliver/:deliveryId', {
    preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
    schema: {
      tags: ['webhooks'],
      summary: 'Redeliver a webhook',
    },
  }, async (request: FastifyRequest<{ Params: { id: string; deliveryId: string } }>, reply: FastifyReply) => {
    const { id, deliveryId } = request.params
    
    const delivery = await fastify.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, webhookId: id },
      include: { webhook: true },
    })
    
    if (!delivery) {
      return reply.status(404).send({ error: 'Delivery not found' })
    }
    
    // TODO: Queue redelivery
    
    return { success: true, message: 'Redelivery queued' }
  })
}
