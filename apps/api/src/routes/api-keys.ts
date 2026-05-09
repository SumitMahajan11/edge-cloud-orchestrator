import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createApiKeySchema, idParamSchema } from '../schemas';
import { zodToFastifySchema } from '../utils/zod-schema';

export default async function apiKeyRoutes(fastify: FastifyInstance) {
  // List API keys for the current user
  fastify.get(
    '/',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['api-keys'],
        summary: 'List my API keys',
      },
    },
    async (request, _reply) => {
      const apiKeys = await (fastify.prisma as any).apiKey.findMany({
        where: { userId: request.user!.id },
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

      return apiKeys;
    },
  );

  // Create API key
  fastify.post<{ Body: z.infer<typeof createApiKeySchema> }>(
    '/',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: zodToFastifySchema(createApiKeySchema),
        tags: ['api-keys'],
        summary: 'Create a new API key',
      },
    },
    async (request, reply) => {
      const { name, permissions, expiresAt } = request.body;
      const apiKeyService = (fastify as any).apiKeyService;
      
      const result = await apiKeyService.createApiKey(
        request.user!.id,
        name,
        permissions
      );

      // Add expiresAt if provided
      if (expiresAt) {
        await (fastify.prisma as any).apiKey.update({
          where: { name_userId: { name, userId: request.user!.id } }, // Assuming unique constraint or find by name
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
      preHandler: [fastify.authenticate],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['api-keys'],
        summary: 'Revoke an API key',
      },
    },
    async (request, _reply) => {
      const apiKeyService = (fastify as any).apiKeyService;
      await apiKeyService.revokeApiKey(request.params.id, request.user!.id);
      return { success: true };
    },
  );
}
