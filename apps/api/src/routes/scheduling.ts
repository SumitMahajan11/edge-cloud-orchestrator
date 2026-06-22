import { Permissions } from '@edgecloud/shared-kernel';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TenantId } from '../types/fastify.js';

import { zodToFastifySchema } from '../utils/zod-schema.js';

const SchedulingPolicySchema = z.object({
  costWeight: z.number().min(0).max(1),
  latencyWeight: z.number().min(0).max(1),
  carbonWeight: z.number().min(0).max(1),
}).refine(
  (data) => {
    const sum = data.costWeight + data.latencyWeight + data.carbonWeight;
    return Math.abs(sum - 1.0) < 0.01;
  },
  {
    message: "Weights must sum to 1.0 (or 100%)",
    path: ["costWeight"],
  }
);

export default async function schedulingRoutes(fastify: FastifyInstance) {
  // GET /v2/scheduling/policy
  fastify.get(
    '/policy',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.SCHEDULER_READ),
      ],
      schema: {
        tags: ['scheduling'],
        summary: 'Get per-tenant scheduling policy',
      },
    },
    async (request, reply) => {
      const tenantId = request.user?.tenantId;
      if (!tenantId) {
        return reply.status(400).send({ error: 'Tenant context required' });
      }

      const policy = await request.tPrisma.schedulingPolicy.findFirst({
        where: { isActive: true },
      });

      if (!policy) {
        // Return default weights if not set
        return {
          id: 'default',
          name: `Tunable Scheduling Policy - ${tenantId}`,
          type: 'TUNABLE',
          config: {
            costWeight: 0.33,
            latencyWeight: 0.33,
            carbonWeight: 0.34,
          },
          tenantId,
          isActive: true,
        };
      }

      return policy;
    }
  );

  // PUT /v2/scheduling/policy
  fastify.put<{ Body: z.infer<typeof SchedulingPolicySchema> }>(
    '/policy',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.SCHEDULER_MANAGE),
      ],
      schema: {
        body: zodToFastifySchema(SchedulingPolicySchema),
        tags: ['scheduling'],
        summary: 'Update per-tenant scheduling policy weights',
      },
    },
    async (request, reply) => {
      const tenantId = request.user?.tenantId;
      if (!tenantId) {
        return reply.status(400).send({ error: 'Tenant context required' });
      }

      const parsed = SchedulingPolicySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: parsed.error.errors[0]?.message || 'Weights must sum to 1.0',
          errors: parsed.error.errors,
        });
      }

      const { costWeight, latencyWeight, carbonWeight } = parsed.data;
      const policyName = `Tunable Scheduling Policy - ${tenantId}`;
      const config = { costWeight, latencyWeight, carbonWeight };

      // Check if active policy exists
      const existing = await request.tPrisma.schedulingPolicy.findFirst({
        where: { name: policyName },
      });

      let policy;
      if (existing) {
        policy = await request.tPrisma.schedulingPolicy.update({
          where: { id: existing.id },
          data: {
            config,
            isActive: true,
          },
        });
      } else {
        policy = await request.tPrisma.schedulingPolicy.create({
          data: {
            name: policyName,
            type: 'TUNABLE',
            config,
            isActive: true,
            tenantId,
          },
        });
      }

      // Invalidate the Redis cache
      const cacheKey = `tenant:policy:${tenantId}`;
      try {
        await fastify.redis.del(cacheKey);
      } catch (err) {
        fastify.log.error({ err, tenantId }, 'Failed to delete cached policy weights from Redis');
      }

      // Notify clients via WebSocket
      if (fastify.wsManager) {
        fastify.wsManager.broadcastToTenant(
          tenantId as TenantId,
          'scheduling-policy-changed',
          {
            tenantId,
            config,
          }
        );
      }

      return {
        success: true,
        policy,
      };
    }
  );
}
