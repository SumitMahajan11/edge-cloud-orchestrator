import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserRole } from '../types/fastify';

export const authState = {
  authenticate: async (
    _request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> => {
    throw new Error(
      'fastify.authenticate was called before authPlugin was initialized',
    );
  },
  requireRole:
    (..._roles: (UserRole | string)[]) =>
    async (_request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      throw new Error(
        'fastify.requireRole was called before authPlugin was initialized',
      );
    },
  requirePermission:
    (_permission: string) =>
    async (_request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      throw new Error(
        'fastify.requirePermission was called before authPlugin was initialized',
      );
    },
};
