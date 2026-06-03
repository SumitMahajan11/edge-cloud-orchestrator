import { Permissions } from '@edgecloud/shared-kernel';
import { FastifyInstance, FastifyReply,FastifyRequest } from 'fastify';
import { zodToFastifySchema } from '../utils/zod-schema.js';
import { carbonSavingsQuerySchema, carbonPolicyUpdateSchema } from '../schemas';

/**
 * Carbon & Eco-Scheduling Routes (v2)
 */
export default async function carbonRoutes(fastify: FastifyInstance) {
  const { taskScheduler } = fastify as any;

  // GET /api/v2/carbon/intensity
  fastify.get(
    '/intensity',
    {
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.CARBON_READ)],
      schema: {
        tags: ['carbon'],
        summary: 'Get regional carbon intensity',
        response: {
          200: {
            type: 'object',
            properties: {
              regions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    zone: { type: 'string' },
                    carbonIntensityGco2: { type: 'number' },
                    lastUpdatedAt: { type: 'string' },
                    source: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      if (!taskScheduler) {return { regions: [] };}
      return taskScheduler.getCarbonIntensityData();
    }
  );

  // GET /api/v2/carbon/summary
  fastify.get(
    '/summary',
    {
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.CARBON_READ)],
      schema: {
        tags: ['carbon'],
        summary: 'Get carbon footprint summary',
        response: {
          200: {
            type: 'object',
            properties: {
              totalSavedGco2Today: { type: 'number' },
              totalSavedGco2Week: { type: 'number' },
              equivalentTreesPlanted: { type: 'number' },
            }
          }
        }
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      if (!taskScheduler) {return { totalSavedGco2Today: 0, totalSavedGco2Week: 0, equivalentTreesPlanted: 0 };}
      const savings = await taskScheduler.getCarbonSavingsData(1);
      return {
        totalSavedGco2Today: savings.totalSavedGco2Today,
        totalSavedGco2Week: savings.totalSavedGco2Week,
        equivalentTreesPlanted: savings.equivalentTreesPlanted,
      };
    }
  );

  // GET /api/v2/carbon/by-region
  fastify.get(
    '/by-region',
    {
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.CARBON_READ)],
      schema: {
        tags: ['carbon'],
        summary: 'Get carbon breakdown by region',
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                zone: { type: 'string' },
                carbonIntensityGco2: { type: 'number' },
                lastUpdatedAt: { type: 'string' },
                source: { type: 'string' }
              }
            }
          }
        }
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      if (!taskScheduler) {return [];}
      const data = await taskScheduler.getCarbonIntensityData();
      return data.regions;
    }
  );

  // GET /api/v2/carbon/savings
  fastify.get(
    '/savings',
    {
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.CARBON_READ)],
      schema: {
        tags: ['carbon'],
        summary: 'Get carbon savings metrics',
        querystring: zodToFastifySchema(carbonSavingsQuerySchema),
        response: {
          200: {
            type: 'object',
            properties: {
              totalSavedGco2Today: { type: 'number' },
              totalSavedGco2Week: { type: 'number' },
              equivalentTreesPlanted: { type: 'number' },
              savingsHistory: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    date: { type: 'string' },
                    savedGco2: { type: 'number' }
                  }
                }
              }
            }
          }
        }
      },
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { days } = (request.query as any) || { days: 7 };
      if (!taskScheduler) {return { totalSavedGco2Today: 0, totalSavedGco2Week: 0, equivalentTreesPlanted: 0, savingsHistory: [] };}
      return taskScheduler.getCarbonSavingsData(days);
    }
  );

  // GET /api/v2/carbon/policy
  fastify.get(
    '/policy',
    {
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.CARBON_READ)],
      schema: {
        tags: ['carbon'],
        summary: 'Get active carbon optimization policy',
        response: {
          200: {
            type: 'object',
            properties: {
              carbonWeight: { type: 'number' },
              isActive: { type: 'boolean' },
              activePolicy: { type: 'string' }
            }
          }
        }
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      if (!taskScheduler) {return { carbonWeight: 0.2, isActive: false, activePolicy: 'None' };}
      return taskScheduler.getCarbonPolicyData();
    }
  );

  // PATCH /api/v2/carbon/policy
  fastify.patch(
    '/policy',
    {
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.CARBON_POLICY_WRITE)],
      schema: {
        tags: ['carbon'],
        summary: 'Update carbon optimization weight',
        body: zodToFastifySchema(carbonPolicyUpdateSchema),
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              carbonWeight: { type: 'number' }
            }
          }
        }
      },
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { carbonWeight } = request.body as any;
      if (!taskScheduler) {return { success: false, carbonWeight: 0 };}
      return taskScheduler.updateCarbonPolicy(carbonWeight);
    }
  );
}
