import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { zodToFastifySchema } from '../utils/zod-schema.js';

const PolicySchema = z.object({
  policy: z.string(),
});

const ThresholdsSchema = z.object({
  cpu: z.number().min(0).max(100).optional(),
  memory: z.number().min(0).max(100).optional(),
  latency: z.number().min(0).optional(),
});

export default async function policyRoutes(fastify: FastifyInstance) {
  // Get all policies
  fastify.get(
    '/',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['policies'],
        summary: 'List available scheduling policies',
      },
    },
    async (_request, _reply) => {
      const policies = [
        { id: 'balanced', name: 'Balanced', description: 'Equal weight to all factors' },
        { id: 'cost', name: 'Cost Optimized', description: 'Minimize infrastructure spend' },
        { id: 'latency', name: 'Latency Optimized', description: 'Minimize response time' },
        { id: 'ml', name: 'ML Enhanced', description: 'Predictive placement using ML' },
      ];

      return {
        active: 'balanced', // Mocking active policy for now
        available: policies,
      };
    },
  );

  // Get active policy
  fastify.get(
    '/active',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['policies'],
        summary: 'Get the currently active scheduling policy',
      },
    },
    async (_request, _reply) => {
      return {
        policy: 'balanced',
        updatedAt: new Date().toISOString(),
      };
    },
  );

  // Update active policy
  fastify.patch<{ Body: z.infer<typeof PolicySchema> }>(
    '/active',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
      schema: {
        body: zodToFastifySchema(PolicySchema),
        tags: ['policies'],
        summary: 'Update the active scheduling policy',
      },
    },
    async (request, _reply) => {
      const { policy } = request.body;
      
      // In a real app, we would update this in DB or Redis
      return {
        success: true,
        policy,
        updatedAt: new Date().toISOString(),
      };
    },
  );

  // Get policy config
  fastify.get(
    '/config',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['policies'],
        summary: 'Get detailed configuration for all policies',
      },
    },
    async (_request, _reply) => {
      return {
        balanced: { latency: 0.25, cost: 0.25, cpu: 0.25, memory: 0.25 },
        cost: { latency: 0.1, cost: 0.6, cpu: 0.15, memory: 0.15 },
        latency: { latency: 0.6, cost: 0.1, cpu: 0.15, memory: 0.15 },
      };
    },
  );

  // Get thresholds
  fastify.get(
    '/thresholds',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['policies'],
        summary: 'Get system health thresholds',
      },
    },
    async (_request, _reply) => {
      return {
        cpu: 80,
        memory: 85,
        latency: 200,
      };
    },
  );

  // Update thresholds
  fastify.patch<{ Body: z.infer<typeof ThresholdsSchema> }>(
    '/thresholds',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
      schema: {
        body: zodToFastifySchema(ThresholdsSchema),
        tags: ['policies'],
        summary: 'Update system health thresholds',
      },
    },
    async (request, _reply) => {
      const thresholds = request.body;
      return {
        success: true,
        thresholds,
        updatedAt: new Date().toISOString(),
      };
    },
  );
}
