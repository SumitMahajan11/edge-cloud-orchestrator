import { Permissions } from '@edgecloud/shared-kernel';
import { FastifyInstance } from 'fastify';

export default async function systemRoutes(fastify: FastifyInstance) {
  // Get circuit breaker health
  fastify.get(
    '/circuit-breakers',
    {
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.SYSTEM_READ)],
      schema: {
        tags: ['system'],
        summary: 'Get system circuit breaker status',
      },
    },
    async (_request, _reply) => {
      // Mocked circuit breaker data
      return {
        database: 'CLOSED',
        redis: 'CLOSED',
        mlService: 'CLOSED',
        lastTrip: null,
      };
    },
  );

  // Get system info
  fastify.get(
    '/info',
    {
      preHandler: [fastify.authenticate, fastify.requirePermission(Permissions.SYSTEM_READ)],
      schema: {
        tags: ['system'],
        summary: 'Get system information',
      },
    },
    async () => {
      return {
        version: '4.0.0',
        environment: process.env.NODE_ENV || 'development',
        uptime: process.uptime(),
      };
    },
  );
}
