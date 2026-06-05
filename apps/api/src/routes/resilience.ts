import { Permissions } from '@edgecloud/shared-kernel';
import { FastifyPluginAsync } from 'fastify';
import { zodToFastifySchema } from '../utils/zod-schema.js';
import { resilienceResetParamSchema } from '../schemas';

import {
  getAllCircuitBreakerStates,
  globalCircuitBreakerRegistry,
} from '../utils/circuit-breakers.js';

const resilienceRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/v2/circuit-breakers
   * Returns state of all registered circuit breakers
   */
  fastify.get(
    '/',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.SYSTEM_READ),
      ],
      schema: {
        tags: ['resilience'],
        summary: 'Get all circuit breaker states',
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                state: {
                  type: 'string',
                  enum: ['CLOSED', 'OPEN', 'HALF_OPEN'],
                },
                failureRate: { type: 'number' },
                lastStateChange: { type: 'string' },
                successCount: { type: 'number' },
                failureCount: { type: 'number' },
                nextRetryAt: { type: 'string' },
              },
            },
          },
        },
      },
    },
    async () => {
      return getAllCircuitBreakerStates();
    },
  );

  /**
   * POST /api/v2/circuit-breakers/:name/reset
   * Force a circuit breaker into CLOSED (or HALF_OPEN) state
   */
  fastify.post(
    '/:name/reset',
    {
      schema: {
        tags: ['resilience'],
        summary: 'Force reset a circuit breaker',
        params: zodToFastifySchema(resilienceResetParamSchema),
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
            },
          },
          404: {
            $ref: 'ErrorSchema#',
          },
        },
      },
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.CIRCUIT_BREAKER_RESET),
      ],
    },
    async (request, reply) => {
      const { name } = request.params as { name: string };
      const breaker = globalCircuitBreakerRegistry.get(name);

      if (!breaker) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Circuit breaker '${name}' not found`,
            requestId: request.id,
          },
        });
      }

      // Force close transitions it to CLOSED, which allows new calls (effectively HALF_OPEN in behavior for recovery)
      breaker.forceClose();

      fastify.log.warn(
        { adminId: (request as any).user?.id, breaker: name },
        'Admin force-closed circuit breaker',
      );

      return {
        success: true,
        message: `Circuit breaker '${name}' has been force-closed and is now attempting recovery.`,
      };
    },
  );
};

export default resilienceRoutes;
