import { Permissions } from '@edgecloud/shared-kernel';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { zodToFastifySchema } from '../utils/zod-schema.js';
import { mlDriftHistoryQuerySchema } from '../schemas';

/**
 * ML Pipeline Monitoring Routes (v2)
 */
export default async function mlRoutes(fastify: FastifyInstance) {
  const { taskScheduler } = fastify as any;

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
      const { hours } = (request.query as any) || { hours: 24 };
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
}
