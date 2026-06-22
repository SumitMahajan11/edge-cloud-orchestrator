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
      const models = await fastify.prisma.fLModel.findMany({
        where: { tenantId: request.user!.tenantId! },
        include: {
          sessions: {
            orderBy: { startedAt: 'desc' },
            take: 10,
          },
          _count: { select: { sessions: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return {
        data: models,
        pagination: {
          page: 1,
          limit: models.length || 50,
          total: models.length,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
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
      const {
        name,
        version,
        architecture,
        parameters,
        weightsUrl,
        weightsSize,
      } = request.body;

      const model = await fastify.prisma.fLModel.create({
        data: {
          name,
          version,
          architecture,
          parameters,
          weightsUrl: weightsUrl ?? null,
          weightsSize: weightsSize ?? null,
          tenantId: request.user!.tenantId!,
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
      const model = await fastify.prisma.fLModel.findUnique({
        where: { id: request.params.id, tenantId: request.user!.tenantId! },
        include: {
          sessions: {
            orderBy: { startedAt: 'desc' },
            take: 10,
          },
        },
      });

      if (!model) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Model not found',
            requestId: request.id,
          },
        });
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
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: 'No file uploaded',
            requestId: request.id,
          },
        });
      }

      const buffer = await data.toBuffer();
      const modelId = request.params.id;

      const model = await fastify.prisma.fLModel.findUnique({
        where: { id: modelId, tenantId: request.user!.tenantId! },
      });

      if (!model) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Model not found',
            requestId: request.id,
          },
        });
      }

      try {
        const { url: weightsUrl, checksum: weightsChecksum } = await fastify.modelStorage.uploadWeights(modelId, buffer);

        await fastify.prisma.fLModel.update({
          where: { id: modelId, tenantId: request.user!.tenantId! },
          data: {
            weightsUrl,
            weightsSize: buffer.length,
            weightsChecksum,
          },
        });

        return {
          success: true,
          weightsUrl,
          weightsChecksum,
          size: buffer.length,
        };
      } catch (err: any) {
        fastify.log.error({ err }, 'Failed to upload weights to S3');
        return reply.status(500).send({
          error: {
            code: 'STORAGE_ERROR',
            message: 'Storage backend error',
            requestId: request.id,
          },
        });
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
      const model = await fastify.prisma.fLModel.findUnique({
        where: { id: request.params.id, tenantId: request.user!.tenantId! },
      });

      if (!model || !model.weightsUrl) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Weights not found',
            requestId: request.id,
          },
        });
      }

      try {
        const buffer = await fastify.modelStorage.downloadWeights(
          model.weightsUrl,
          model.weightsChecksum || undefined,
        );

        void reply.header('Content-Type', 'application/octet-stream');
        void reply.header(
          'Content-Disposition',
          `attachment; filename="weights_${model.version}.bin"`,
        );
        return reply.send(buffer);
      } catch (err: any) {
        fastify.log.error({ err }, 'Failed to download weights from S3');
        return reply.status(500).send({
          error: {
            code: 'STORAGE_ERROR',
            message: 'Storage backend error',
            requestId: request.id,
          },
        });
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

      const model = await fastify.prisma.fLModel.findUnique({
        where: { id: modelId, tenantId: request.user!.tenantId! },
      });

      if (!model) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Model not found',
            requestId: request.id,
          },
        });
      }

      const nodes = await fastify.prisma.edgeNode.findMany({
        where: {
          status: 'ONLINE',
          isMaintenanceMode: false,
          tenantId: request.user!.tenantId!,
        },
        take: config?.maxClients || 10,
      });

      if (nodes.length < (config?.minClients || 3)) {
        return reply.status(400).send({
          error: {
            code: 'INSUFFICIENT_CLIENTS',
            message: 'Insufficient clients',
            details: {
              available: nodes.length,
              required: config?.minClients || 3,
            },
            requestId: request.id,
          },
        });
      }

      const session = await fastify.prisma.fLSession.create({
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
      const session = await fastify.prisma.fLSession.findUnique({
        where: {
          id: request.params.id,
          model: { tenantId: request.user!.tenantId! },
        },
        include: { model: true },
      });

      if (!session) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Session not found',
            requestId: request.id,
          },
        });
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
      const session = await fastify.prisma.fLSession.update({
        where: {
          id: request.params.id,
          model: { tenantId: request.user!.tenantId! },
        },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      return session;
    },
  );
}
