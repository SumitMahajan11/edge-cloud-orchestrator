import { FastifyPluginAsync } from 'fastify';
import { 
  getAllCircuitBreakerStates, 
  globalCircuitBreakerRegistry 
} from '../utils/circuit-breakers.ts';

const resilienceRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/v2/circuit-breakers
   * Returns state of all registered circuit breakers
   */
  fastify.get('/', {
    preHandler: [fastify.authenticate],
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
              state: { type: 'string', enum: ['CLOSED', 'OPEN', 'HALF_OPEN'] },
              failureRate: { type: 'number' },
              lastStateChange: { type: 'string' },
              successCount: { type: 'number' },
              failureCount: { type: 'number' },
              nextRetryAt: { type: 'string' }
            }
          }
        }
      }
    }
  }, async () => {
    return getAllCircuitBreakerStates();
  });

  /**
   * POST /api/v2/circuit-breakers/:name/reset
   * Force a circuit breaker into CLOSED (or HALF_OPEN) state
   */
  fastify.post('/:name/reset', {
    schema: {
      tags: ['resilience'],
      summary: 'Force reset a circuit breaker',
      params: {
        type: 'object',
        properties: {
          name: { type: 'string' }
        },
        required: ['name']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      }
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')]
  }, async (request, reply) => {
    const { name } = request.params as { name: string };
    const breaker = globalCircuitBreakerRegistry.get(name);

    if (!breaker) {
      return reply.code(404).send({ error: `Circuit breaker '${name}' not found` });
    }

    // Force close transitions it to CLOSED, which allows new calls (effectively HALF_OPEN in behavior for recovery)
    breaker.forceClose();
    
    fastify.log.warn({ adminId: (request as any).user?.id, breaker: name }, 'Admin force-closed circuit breaker');

    return { 
      success: true, 
      message: `Circuit breaker '${name}' has been force-closed and is now attempting recovery.` 
    };
  });
};

export default resilienceRoutes;
