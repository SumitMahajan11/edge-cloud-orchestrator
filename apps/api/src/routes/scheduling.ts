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

  // GET /v2/scheduling/policies
  fastify.get(
    '/policies',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.SCHEDULER_READ),
      ],
      schema: {
        tags: ['scheduling'],
        summary: 'Get all scheduling policies for the tenant',
      },
    },
    async (request, reply) => {
      const tenantId = request.user?.tenantId;
      if (!tenantId) {
        return reply.status(400).send({ error: 'Tenant context required' });
      }

      let policies = await request.tPrisma.schedulingPolicy.findMany();

      if (policies.length === 0) {
        const defaultTemplates = [
          {
            name: `Tunable Scheduling Policy - ${tenantId}`,
            type: 'TUNABLE',
            config: {
              costWeight: 0.33,
              latencyWeight: 0.33,
              carbonWeight: 0.34,
            },
            isActive: true,
          },
          {
            name: `Latency SLA Guard - ${tenantId}`,
            type: 'LATENCY',
            config: {
              maxLatencyMs: 150,
            },
            isActive: false,
          },
          {
            name: `Eco-First Optimization - ${tenantId}`,
            type: 'CARBON',
            config: {
              minGreenPercent: 80,
            },
            isActive: false,
          },
          {
            name: `Cost Guardrail - ${tenantId}`,
            type: 'COST',
            config: {
              maxCostUSD: 0.05,
            },
            isActive: false,
          },
        ];

        for (const template of defaultTemplates) {
          const exists = await request.tPrisma.schedulingPolicy.findFirst({
            where: { name: template.name }
          });
          if (!exists) {
            await request.tPrisma.schedulingPolicy.create({
              data: {
                ...template,
                tenantId,
              },
            });
          }
        }

        policies = await request.tPrisma.schedulingPolicy.findMany();
      }

      return policies;
    }
  );

  // POST /v2/scheduling/policies
  fastify.post<{
    Body: {
      name: string;
      type: string;
      config: Record<string, any>;
      isActive?: boolean;
    };
  }>(
    '/policies',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.SCHEDULER_MANAGE),
      ],
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string' },
            config: { type: 'object' },
            isActive: { type: 'boolean', default: false },
          },
          required: ['name', 'type', 'config'],
        },
        tags: ['scheduling'],
        summary: 'Create a new scheduling policy template',
      },
    },
    async (request, reply) => {
      const tenantId = request.user?.tenantId;
      if (!tenantId) {
        return reply.status(400).send({ error: 'Tenant context required' });
      }

      const { name, type, config, isActive = false } = request.body;

      // If isActive is true, set all other policies to inactive
      if (isActive) {
        await request.tPrisma.schedulingPolicy.updateMany({
          where: { tenantId },
          data: { isActive: false },
        });
      }

      const policy = await request.tPrisma.schedulingPolicy.create({
        data: {
          name,
          type,
          config,
          isActive,
          tenantId,
        },
      });

      if (isActive) {
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
      }

      // Audit log
      await request.tPrisma.auditLog.create({
        data: {
          userId: request.user!.id,
          tenantId: request.user!.tenantId!,
          action: 'scheduling.policy_created',
          entityType: 'policy',
          entityId: policy.id,
          details: { name: policy.name, type: policy.type } as any,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
      });

      return {
        success: true,
        policy,
      };
    }
  );

  // PUT /v2/scheduling/policies/:id
  fastify.put<{
    Params: { id: string };
    Body: {
      name?: string;
      type?: string;
      config?: Record<string, any>;
      isActive?: boolean;
    };
  }>(
    '/policies/:id',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.SCHEDULER_MANAGE),
      ],
      schema: {
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string' },
            config: { type: 'object' },
            isActive: { type: 'boolean' },
          },
        },
        tags: ['scheduling'],
        summary: 'Update an existing scheduling policy',
      },
    },
    async (request, reply) => {
      const tenantId = request.user?.tenantId;
      if (!tenantId) {
        return reply.status(400).send({ error: 'Tenant context required' });
      }

      const { id } = request.params;
      const existing = await request.tPrisma.schedulingPolicy.findFirst({
        where: { id, tenantId },
      });

      if (!existing) {
        return reply.status(404).send({ error: 'Scheduling policy not found' });
      }

      const { name, type, config, isActive } = request.body;

      if (isActive) {
        await request.tPrisma.schedulingPolicy.updateMany({
          where: { tenantId },
          data: { isActive: false },
        });
      }

      const updatedPolicy = await request.tPrisma.schedulingPolicy.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(type !== undefined && { type }),
          ...(config !== undefined && { config }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      // Audit log
      await request.tPrisma.auditLog.create({
        data: {
          userId: request.user!.id,
          tenantId: request.user!.tenantId!,
          action: 'scheduling.policy_updated',
          entityType: 'policy',
          entityId: updatedPolicy.id,
          details: { name: updatedPolicy.name, isActive: updatedPolicy.isActive } as any,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
      });

      return {
        success: true,
        policy: updatedPolicy,
      };
    }
  );

  // DELETE /v2/scheduling/policies/:id
  fastify.delete<{
    Params: { id: string };
  }>(
    '/policies/:id',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.SCHEDULER_MANAGE),
      ],
      schema: {
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
        tags: ['scheduling'],
        summary: 'Delete a scheduling policy',
      },
    },
    async (request, reply) => {
      const tenantId = request.user?.tenantId;
      if (!tenantId) {
        return reply.status(400).send({ error: 'Tenant context required' });
      }

      const { id } = request.params;
      const existing = await request.tPrisma.schedulingPolicy.findFirst({
        where: { id, tenantId },
      });

      if (!existing) {
        return reply.status(404).send({ error: 'Scheduling policy not found' });
      }

      if (existing.isActive) {
        return reply.status(400).send({
          error: 'Cannot delete an active scheduling policy. Please activate another policy first.',
        });
      }

      await request.tPrisma.schedulingPolicy.delete({
        where: { id },
      });

      // Audit log
      await request.tPrisma.auditLog.create({
        data: {
          userId: request.user!.id,
          tenantId: request.user!.tenantId!,
          action: 'scheduling.policy_deleted',
          entityType: 'policy',
          entityId: id,
          details: { name: existing.name } as any,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
      });

      return {
        success: true,
        id,
      };
    }
  );
}

