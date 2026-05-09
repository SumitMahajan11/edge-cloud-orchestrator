import { FastifyInstance } from 'fastify';

export default async function schedulerRoutes(fastify: FastifyInstance) {
  // Get scheduler metrics
  fastify.get(
    '/metrics',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['scheduler'],
        summary: 'Get scheduler-specific metrics',
        response: {
          200: {
            type: 'object',
            properties: {
              queueLength: { type: 'number' },
              avgSchedulingTime: { type: 'number' },
              throughput: { type: 'number' },
              efficiency: { type: 'number' },
            },
          }
        }
      },
    },
    async (_request, _reply) => {
      return {
        queueLength: 5,
        avgSchedulingTime: 45,
        throughput: 120,
        efficiency: 0.92,
      };
    },
  );
}
