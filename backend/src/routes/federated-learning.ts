import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { createFLModelSchema, startFLSessionSchema, idParamSchema } from '../schemas'
import { zodToFastifySchema } from '../utils/zod-schema'

export default async function flRoutes(fastify: FastifyInstance) {
  // List models
  fastify.get('/models', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['federated-learning'], summary: 'List FL models' },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const models = await fastify.prisma.fLModel.findMany({
      include: {
        _count: { select: { sessions: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return models
  })

  // Create model
  fastify.post('/models', {
    preHandler: [fastify.authenticate],
    schema: {
      body: zodToFastifySchema(createFLModelSchema),
      tags: ['federated-learning'],
      summary: 'Register a FL model',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof createFLModelSchema> }>, reply: FastifyReply) => {
    const { name, version, architecture, parameters } = request.body

    const model = await fastify.prisma.fLModel.create({
      data: { name, version, architecture, parameters },
    })

    return reply.status(201).send(model)
  })

  // Get model
  fastify.get('/models/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      params: zodToFastifySchema(idParamSchema),
      tags: ['federated-learning'],
      summary: 'Get FL model',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const model = await fastify.prisma.fLModel.findUnique({
      where: { id: request.params.id },
      include: {
        sessions: {
          orderBy: { startedAt: 'desc' },
          take: 10,
        },
      },
    })

    if (!model) {
      return reply.status(404).send({ error: 'Model not found' })
    }

    return model
  })

  // Start training session
  fastify.post('/sessions', {
    preHandler: [fastify.authenticate],
    schema: {
      body: zodToFastifySchema(startFLSessionSchema),
      tags: ['federated-learning'],
      summary: 'Start FL training session',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof startFLSessionSchema> }>, reply: FastifyReply) => {
    const { modelId, totalRounds, config } = request.body

    const model = await fastify.prisma.fLModel.findUnique({ where: { id: modelId } })

    if (!model) {
      return reply.status(404).send({ error: 'Model not found' })
    }

    const nodes = await fastify.prisma.edgeNode.findMany({
      where: { status: 'ONLINE', isMaintenanceMode: false },
      take: config?.maxClients || 10,
    })

    if (nodes.length < (config?.minClients || 3)) {
      return reply.status(400).send({
        error: 'Insufficient clients',
        available: nodes.length,
        required: config?.minClients || 3,
      })
    }

    const session = await fastify.prisma.fLSession.create({
      data: {
        modelId,
        totalRounds,
        config: config || {},
        status: 'RUNNING',
      },
    })

    return reply.status(201).send(session)
  })

  // Get session
  fastify.get('/sessions/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      params: zodToFastifySchema(idParamSchema),
      tags: ['federated-learning'],
      summary: 'Get FL session',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const session = await fastify.prisma.fLSession.findUnique({
      where: { id: request.params.id },
      include: { model: true },
    })

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }

    return session
  })

  // Stop session
  fastify.post('/sessions/:id/stop', {
    preHandler: [fastify.authenticate],
    schema: {
      params: zodToFastifySchema(idParamSchema),
      tags: ['federated-learning'],
      summary: 'Stop FL session',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const session = await fastify.prisma.fLSession.update({
      where: { id: request.params.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    })

    return session
  })
}
