import { FastifyReply, FastifyRequest } from 'fastify';
import { UserRole } from '../types/fastify';

export const authState = {
  authenticate: async (_request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    throw new Error('fastify.authenticate was called before authPlugin was initialized');
  },
  requireRole: (..._roles: UserRole[]) => async (_request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    throw new Error('fastify.requireRole was called before authPlugin was initialized');
  }
};
