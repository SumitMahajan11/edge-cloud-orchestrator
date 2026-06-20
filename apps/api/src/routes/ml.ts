/**
 * Machine Learning and Federated Learning Routes
 *
 * What it does: Exposes endpoints for tracking ML scheduler drift, model information, outcomes statistics, and coordinating federated aggregation.
 * Handlers:
 * - GET /drift/current — Returns the current drift score, status, and feature drift breakdown.
 * - GET /drift/history — Returns historical drift score metrics over a custom number of hours.
 * - GET /model/current — Returns metadata about the active ML model (version, trained time, accuracy).
 * - GET /outcomes/stats — Returns buffering, bandit exploration rates, and prediction errors.
 * - POST /retrain — Manually retrains the local model and promotes it.
 * - GET /retrain/status — Gets the status of the background retraining job.
 * - GET /federated/round — Retrieves or initializes the current active federated learning round.
 * - GET /federated/model/:modelId/weights — Downloads weights file for a federated learning model.
 * - POST /federated/weights — Submits local node weight URLs after training.
 * - POST /federated/weights/upload — Uploads a binary weights file for a participant node.
 */
import { Permissions } from '@edgecloud/shared-kernel';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { zodToFastifySchema } from '../utils/zod-schema.js';
import { mlDriftHistoryQuerySchema } from '../schemas';

/**
 * ML Pipeline Monitoring Routes (v2)
 */
export default async function mlRoutes(fastify: FastifyInstance) {
  const { taskScheduler } = fastify;

  // GET /api/v2/ml/drift/current
  fastify.get(
    '/drift/current',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.ML_READ),
      ],
      schema: {
        tags: ['ml'],
        summary: 'Get current ML drift status',
        response: {
          200: {
            type: 'object',
            properties: {
              driftScore: { type: 'number' },
              isDrifting: { type: 'boolean' },
              lastCheckedAt: { type: 'string' },
              featureDrift: {
                type: 'object',
                additionalProperties: { type: 'number' },
              },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      if (!taskScheduler) {
        return {
          driftScore: 0,
          isDrifting: false,
          lastCheckedAt: new Date().toISOString(),
          featureDrift: {},
        };
      }
      return await taskScheduler.getMLDriftState();
    },
  );

  // GET /api/v2/ml/drift/history
  fastify.get(
    '/drift/history',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.ML_READ),
      ],
      schema: {
        tags: ['ml'],
        summary: 'Get ML drift history',
        querystring: zodToFastifySchema(mlDriftHistoryQuerySchema),
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                timestamp: { type: 'string' },
                score: { type: 'number' },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { hours } = (request.query as { hours?: number }) || { hours: 24 };
      if (!taskScheduler) {
        return [];
      }
      return await taskScheduler.getMLDriftHistory(hours);
    },
  );

  // GET /api/v2/ml/model/current
  fastify.get(
    '/model/current',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.ML_READ),
      ],
      schema: {
        tags: ['ml'],
        summary: 'Get current ML model status',
        response: {
          200: {
            type: 'object',
            properties: {
              version: { type: 'string' },
              trainedAt: { type: 'string' },
              accuracy: { type: 'number' },
              fallbackRate: { type: 'number' },
              lastUpdatedAt: { type: 'string' },
              modelType: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      if (!taskScheduler) {
        return null;
      }
      return taskScheduler.getMLModelCurrent();
    },
  );

  // GET /api/v2/ml/outcomes/stats
  fastify.get(
    '/outcomes/stats',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.ML_READ),
      ],
      schema: {
        tags: ['ml'],
        summary: 'Get ML outcome collection stats',
        response: {
          200: {
            type: 'object',
            properties: {
              outcomesBuffered: { type: 'number' },
              banditExplorationRate: { type: 'number' },
              predictionErrorP99Ms: { type: 'number' },
              nextUpdateAt: { type: 'number' },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      if (!taskScheduler) {
        return {
          outcomesBuffered: 0,
          banditExplorationRate: 0.1,
          predictionErrorP99Ms: 0,
          nextUpdateAt: 500,
        };
      }
      return taskScheduler.getMLOutcomeStats();
    },
  );

  // POST /api/v2/ml/retrain
  fastify.post(
    '/retrain',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.ML_RETRAIN),
      ],
      schema: {
        tags: ['ml'],
        summary: 'Manually trigger model retraining',
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
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      if (!taskScheduler) {
        return { success: false, message: 'TaskScheduler not initialized' };
      }
      return taskScheduler.triggerMLRetrain();
    },
  );

  // GET /api/v2/ml/retrain/status
  fastify.get(
    '/retrain/status',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.ML_READ),
      ],
      schema: {
        tags: ['ml'],
        summary: 'Get status of current retraining job',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              error: { type: 'string', nullable: true },
              lastStartedAt: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      if (!taskScheduler) {
        return { status: 'IDLE' };
      }
      return taskScheduler.getMLRetrainStatus();
    },
  );

  // GET /api/v2/ml/federated/round
  fastify.get(
    '/federated/round',
    {
      schema: {
        tags: ['ml'],
        summary: 'Get or initialize current active federated learning round',
        response: {
          200: {
            type: 'object',
            properties: {
              roundId: { type: 'string' },
              roundNumber: { type: 'number' },
              modelId: { type: 'string' },
              status: { type: 'string' },
              minParticipants: { type: 'number' },
              submissionsCount: { type: 'number' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = await resolveTenantId(fastify, request, reply);
      if (reply.sent) return;

      let round = await fastify.prisma.federatedRound.findFirst({
        where: { tenantId, status: 'RUNNING' },
        include: { submissions: true },
      });

      if (!round) {
        // Find active FL model or fallback to default
        const activeModel = await fastify.prisma.fLModel.findFirst({
          where: { tenantId, isActive: true },
        });
        const modelId = activeModel?.id || 'default-fl-model-id';

        const lastRound = await fastify.prisma.federatedRound.findFirst({
          where: { tenantId },
          orderBy: { roundNumber: 'desc' },
        });
        const roundNumber = lastRound ? lastRound.roundNumber + 1 : 1;

        round = await fastify.prisma.federatedRound.create({
          data: {
            modelId,
            roundNumber,
            status: 'RUNNING',
            minParticipants: 3,
            tenantId,
          },
          include: { submissions: true },
        });
      }

      return {
        roundId: round.id,
        roundNumber: round.roundNumber,
        modelId: round.modelId,
        status: round.status,
        minParticipants: round.minParticipants,
        submissionsCount: round.submissions.length,
      };
    },
  );

  // GET /api/v2/ml/federated/model/:modelId/weights
  fastify.get(
    '/federated/model/:modelId/weights',
    {
      schema: {
        tags: ['ml'],
        summary: 'Download weights for a federated learning model',
        params: {
          type: 'object',
          required: ['modelId'],
          properties: {
            modelId: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = await resolveTenantId(fastify, request, reply);
      if (reply.sent) return;

      const { modelId } = request.params as { modelId: string };

      // Find the FL model or use default fallback if it's 'default-fl-model-id'
      let model = await fastify.prisma.fLModel.findFirst({
        where: { id: modelId, tenantId },
      });

      if (!model && modelId === 'default-fl-model-id') {
        model = await fastify.prisma.fLModel.findFirst({
          where: { tenantId, isActive: true },
        });
      }

      if (!model || !model.weightsUrl) {
        try {
          const activeModel = await fastify.taskScheduler?.modelRegistry?.getActiveModel();
          if (activeModel) {
            const activeVersion = activeModel.version;
            const fs = await import('fs');
            const path = await import('path');
            const binPath = path.join(
              fastify.taskScheduler.modelRegistry.MODEL_DIR,
              `model_${activeVersion}.bin`
            );
            if (fs.existsSync(binPath)) {
              const buffer = fs.readFileSync(binPath);
              void reply.header('Content-Type', 'application/octet-stream');
              return reply.send(buffer);
            }
          }
        } catch (err) {
          fastify.log.warn({ err }, 'Failed to load local active model weights');
        }

        const zeros = new Float32Array(961);
        const buffer = Buffer.from(zeros.buffer, zeros.byteOffset, zeros.byteLength);
        void reply.header('Content-Type', 'application/octet-stream');
        return reply.send(buffer);
      }

      try {
        const buffer = await fastify.modelStorage.downloadWeights(
          model.weightsUrl,
          model.weightsChecksum || undefined
        );

        void reply.header('Content-Type', 'application/octet-stream');
        return reply.send(buffer);
      } catch (err: any) {
        fastify.log.error({ err }, 'Failed to download weights from S3');
        return reply.status(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to download model weights',
            requestId: request.id,
          },
        });
      }
    }
  );

  // POST /api/v2/ml/federated/weights
  fastify.post(
    '/federated/weights',
    {
      schema: {
        tags: ['ml'],
        summary: 'Submit local model weight deltas for federated aggregation',
        body: {
          type: 'object',
          required: ['roundId', 'nodeId', 'weightsUrl', 'sampleCount'],
          properties: {
            roundId: { type: 'string' },
            nodeId: { type: 'string' },
            weightsUrl: { type: 'string' },
            sampleCount: { type: 'number' },
            avgReward: { type: 'number', nullable: true },
          },
        },
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
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = await resolveTenantId(fastify, request, reply);
      if (reply.sent) return;

      const { roundId, nodeId, weightsUrl, sampleCount, avgReward } = request.body as {
        roundId: string;
        nodeId: string;
        weightsUrl: string;
        sampleCount: number;
        avgReward?: number;
      };

      const round = await fastify.prisma.federatedRound.findUnique({
        where: { id: roundId },
      });

      if (!round) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Federated round not found',
            requestId: request.id,
          },
        });
      }

      if (round.status !== 'RUNNING') {
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: 'Round is no longer active',
            requestId: request.id,
          },
        });
      }

      await fastify.prisma.federatedWeightSubmission.upsert({
        where: {
          roundId_nodeId: { roundId, nodeId },
        },
        update: {
          weightsUrl,
          sampleCount,
          avgReward: avgReward ?? 0.0,
        },
        create: {
          roundId,
          nodeId,
          weightsUrl,
          sampleCount,
          avgReward: avgReward ?? 0.0,
          tenantId,
        },
      });

      const submissionsCount = await fastify.prisma.federatedWeightSubmission.count({
        where: { roundId },
      });

      if (submissionsCount >= round.minParticipants) {
        // Trigger aggregation asynchronously
        void (async () => {
          try {
            const { FederatedAggregator } = await import('@edgecloud/ml-scheduler');
            const aggregator = new FederatedAggregator(
              fastify.prisma,
              fastify.modelStorage,
              fastify.taskScheduler?.modelRegistry
            );
            await aggregator.aggregate(roundId);
          } catch (err) {
            fastify.log.error({ err, roundId }, 'Federated aggregation failed');
          }
        })();
      }

      return {
        success: true,
        message: 'Weights submitted successfully',
      };
    },
  );

  // POST /api/v2/ml/federated/weights/upload
  fastify.post(
    '/federated/weights/upload',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = await resolveTenantId(fastify, request, reply);
      if (reply.sent) return;

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      const roundId = (data.fields.roundId as { value?: string })?.value;
      const nodeId = (data.fields.nodeId as { value?: string })?.value;
      const sampleCount = parseInt((data.fields.sampleCount as { value?: string })?.value || '0', 10);
      const avgReward = parseFloat((data.fields.avgReward as { value?: string })?.value || '0.0');

      if (!roundId || !nodeId) {
        return reply.status(400).send({ error: 'Missing roundId or nodeId' });
      }

      const round = await fastify.prisma.federatedRound.findUnique({
        where: { id: roundId },
      });

      if (!round) {
        return reply.status(404).send({ error: 'Federated round not found' });
      }

      if (round.status !== 'RUNNING') {
        return reply.status(400).send({ error: 'Round is no longer active' });
      }

      const buffer = await data.toBuffer();
      const { url: weightsUrl } = await fastify.modelStorage.uploadWeights(
        `${roundId}_${nodeId}`,
        buffer
      );

      await fastify.prisma.federatedWeightSubmission.upsert({
        where: {
          roundId_nodeId: { roundId, nodeId },
        },
        update: {
          weightsUrl,
          sampleCount,
          avgReward,
        },
        create: {
          roundId,
          nodeId,
          weightsUrl,
          sampleCount,
          avgReward,
          tenantId,
        },
      });

      const submissionsCount = await fastify.prisma.federatedWeightSubmission.count({
        where: { roundId },
      });

      if (submissionsCount >= round.minParticipants) {
        void (async () => {
          try {
            const { FederatedAggregator } = await import('@edgecloud/ml-scheduler');
            const aggregator = new FederatedAggregator(
              fastify.prisma,
              fastify.modelStorage,
              fastify.taskScheduler?.modelRegistry
            );
            await aggregator.aggregate(roundId);
          } catch (err) {
            fastify.log.error({ err, roundId }, 'Federated aggregation failed');
          }
        })();
      }

      return {
        success: true,
        weightsUrl,
      };
    },
  );
}


async function resolveTenantId(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string> {
  const cert = (request.raw.socket as import('tls').TLSSocket).getPeerCertificate?.();
  const nodeId =
    cert?.subject?.CN ||
    (process.env.NODE_ENV !== 'production'
      ? request.headers['x-node-id']
      : null);

  if (nodeId) {
    const node = await fastify.prisma.edgeNode.findUnique({
      where: { id: nodeId as string },
      select: { tenantId: true },
    });
    if (node) {
      const { enterWithTenantContext } = await import('@edgecloud/shared-kernel');
      enterWithTenantContext(node.tenantId);
      return node.tenantId;
    }
  }

  // Fallback to JWT
  if (!request.user) {
    await fastify.authenticate(request, reply);
  }

  if (!request.user?.tenantId) {
    throw new Error('Tenant context missing');
  }

  return request.user.tenantId;
}
