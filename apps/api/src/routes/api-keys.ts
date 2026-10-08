import { Permissions } from '@edgecloud/shared-kernel';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { createApiKeySchema, idParamSchema } from '../schemas';
import { zodToFastifySchema } from '../utils/zod-schema';

export default async function apiKeyRoutes(fastify: FastifyInstance) {
  // List API keys for the current user
  fastify.get(
    '/',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.API_KEY_MANAGE),
      ],
      schema: {
        tags: ['api-keys'],
        summary: 'List my API keys',
      },
    },
    async (request, _reply) => {
      const apiKeys = await fastify.prisma.apiKey.findMany({
        where: { userId: request.user.id },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          permissions: true,
          expiresAt: true,
          createdAt: true,
          lastUsedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        data: apiKeys,
        pagination: {
          page: 1,
          limit: apiKeys.length || 50,
          total: apiKeys.length,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
    },
  );

  // Create API key
  fastify.post<{ Body: z.infer<typeof createApiKeySchema> }>(
    '/',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.API_KEY_MANAGE),
      ],
      schema: {
        body: zodToFastifySchema(createApiKeySchema),
        tags: ['api-keys'],
        summary: 'Create a new API key',
      },
    },
    async (request, reply) => {
      const { name, permissions, expiresAt } = request.body;
      const { apiKeyService } = fastify;

      const result = await apiKeyService.createApiKey(
        request.user.id,
        name,
        permissions,
      );

      // Add expiresAt if provided
      if (expiresAt) {
        await fastify.prisma.apiKey.update({
          where: { name_userId: { name, userId: request.user.id } }, // Assuming unique constraint or find by name
          data: { expiresAt: new Date(expiresAt) },
        });
      }

      return reply.status(201).send(result);
    },
  );

  // Revoke API key
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.API_KEY_MANAGE),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['api-keys'],
        summary: 'Revoke an API key',
      },
    },
    async (request, _reply) => {
      const { apiKeyService } = fastify;
      await apiKeyService.revokeApiKey(request.params.id, request.user.id);
      return { success: true };
    },
  );
}
