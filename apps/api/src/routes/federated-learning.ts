import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  createFLModelSchema,
  idParamSchema,
  startFLSessionSchema,
} from '../schemas';
import { zodToFastifySchema } from '../utils/zod-schema';

export default async function flRoutes(fastify: FastifyInstance) {
  // List models
  fastify.get(
    '/models',
    {
      preHandler: [fastify.authenticate],
      schema: { tags: ['federated-learning'], summary: 'List FL models' },
    },
    async (request) => {
      const models = await (fastify.prisma as any).fLModel.findMany({
        where: { tenantId: request.user!.tenantId! },
        include: {
          _count: { select: { sessions: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return models;
    },
  );

  // Create model
  fastify.post<{ Body: z.infer<typeof createFLModelSchema> }>(
    '/models',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: zodToFastifySchema(createFLModelSchema),
        tags: ['federated-learning'],
        summary: 'Register a FL model',
      },
    },
    async (request, reply) => {
      const { name, version, architecture, parameters, weightsUrl, weightsSize } = request.body;

      const model = await (fastify.prisma as any).fLModel.create({
        data: { 
          name, 
          version, 
          architecture, 
          parameters, 
          weightsUrl: weightsUrl ?? null, 
          weightsSize: weightsSize ?? null, 
          tenantId: request.user!.tenantId! 
        },
      });

      return reply.status(201).send(model);
    },
  );

  // Get model
  fastify.get<{ Params: { id: string } }>(
    '/models/:id',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['federated-learning'],
        summary: 'Get FL model',
      },
    },
    async (request, reply) => {
      const model = await (fastify.prisma as any).fLModel.findUnique({
        where: { id: request.params.id, tenantId: request.user!.tenantId! },
        include: {
          sessions: {
            orderBy: { startedAt: 'desc' },
            take: 10,
          },
        },
      });

      if (!model) {
        return reply.status(404).send({ error: 'Model not found' });
      }

      return model;
    },
  );

  // Upload model weights
  fastify.post<{ Params: { id: string } }>(
    '/models/:id/weights',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['federated-learning'],
        summary: 'Upload weights for a FL model',
      },
    },
    async (request, reply) => {
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      const buffer = await data.toBuffer();
      const modelId = request.params.id;

      const model = await (fastify.prisma as any).fLModel.findUnique({
        where: { id: modelId, tenantId: request.user!.tenantId! },
      });

      if (!model) {
        return reply.status(404).send({ error: 'Model not found' });
      }

      try {
        const { url: weightsUrl, checksum: weightsChecksum } = await (fastify as any).modelStorage.uploadWeights(modelId, buffer);

        await (fastify.prisma as any).fLModel.update({
          where: { id: modelId, tenantId: request.user!.tenantId! },
          data: {
            weightsUrl,
            weightsSize: buffer.length,
            weightsChecksum,
          },
        });

        return { success: true, weightsUrl, weightsChecksum, size: buffer.length };
      } catch (err: any) {
        fastify.log.error({ err }, 'Failed to upload weights to S3');
        return reply.status(500).send({ error: 'Storage backend error', details: err.message });
      }
    },
  );

  // Download model weights
  fastify.get<{ Params: { id: string } }>(
    '/models/:id/weights',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['federated-learning'],
        summary: 'Download weights for a FL model',
      },
    },
    async (request, reply) => {
      const model = await (fastify.prisma as any).fLModel.findUnique({
        where: { id: request.params.id, tenantId: request.user!.tenantId! },
      });

      if (!model || !model.weightsUrl) {
        return reply.status(404).send({ error: 'Weights not found' });
      }

      try {
        const buffer = await (fastify as any).modelStorage.downloadWeights(
          model.weightsUrl, 
          model.weightsChecksum || undefined
        );

        reply.header('Content-Type', 'application/octet-stream');
        reply.header('Content-Disposition', `attachment; filename="weights_${model.version}.bin"`);
        return reply.send(buffer);
      } catch (err: any) {
        fastify.log.error({ err }, 'Failed to download weights from S3');
        return reply.status(500).send({ error: 'Storage backend error', details: err.message });
      }
    },
  );

  // Start training session
  fastify.post<{ Body: z.infer<typeof startFLSessionSchema> }>(
    '/sessions',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: zodToFastifySchema(startFLSessionSchema),
        tags: ['federated-learning'],
        summary: 'Start FL training session',
      },
    },
    async (request, reply) => {
      const { modelId, totalRounds, config } = request.body;

      const model = await (fastify.prisma as any).fLModel.findUnique({
        where: { id: modelId, tenantId: request.user!.tenantId! },
      });

      if (!model) {
        return reply.status(404).send({ error: 'Model not found' });
      }

      const nodes = await (fastify.prisma.edgeNode as any).findMany({
        where: { status: 'ONLINE', isMaintenanceMode: false, tenantId: request.user!.tenantId! },
        take: config?.maxClients || 10,
      });

      if (nodes.length < (config?.minClients || 3)) {
        return reply.status(400).send({
          error: 'Insufficient clients',
          available: nodes.length,
          required: config?.minClients || 3,
        });
      }

      const session = await (fastify.prisma as any).fLSession.create({
        data: {
          modelId,
          totalRounds,
          config: (config as any) || {},
          status: 'RUNNING',
          tenantId: request.user!.tenantId!,
        },
      });

      return reply.status(201).send(session);
    },
  );

  // Get session
  fastify.get<{ Params: { id: string } }>(
    '/sessions/:id',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['federated-learning'],
        summary: 'Get FL session',
      },
    },
    async (request, reply) => {
      const session = await (fastify.prisma as any).fLSession.findUnique({
        where: { id: request.params.id, model: { tenantId: request.user!.tenantId! } },
        include: { model: true },
      });

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      return session;
    },
  );

  // Stop session
  fastify.post<{ Params: { id: string } }>(
    '/sessions/:id/stop',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['federated-learning'],
        summary: 'Stop FL session',
      },
    },
    async (request) => {
      const session = await (fastify.prisma as any).fLSession.update({
        where: { id: request.params.id, model: { tenantId: request.user!.tenantId! } },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      return session;
    },
  );
}

