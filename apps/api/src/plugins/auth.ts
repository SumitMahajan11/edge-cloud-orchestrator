// ============================================================================
// Authentication Plugin
// ============================================================================
//
// Provides JWT and API key authentication for Fastify routes.
// Uses types from src/types/fastify.d.ts
// ============================================================================

import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AuthService } from '../services/auth.service';
import { RateLimitService } from '../services/rate-limit.service';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import type { UserPayload, UserRole } from '../types/fastify';

import { authState } from '../initializers/auth-state';

export const authPlugin = fp(async (fastify: FastifyInstance) => {
  fastify.log.info('Registering authPlugin...');
  // 1. Instantiate Services

  // Note: fastify.prisma and fastify.redis are assumed to be decorated already
  const authService = new AuthService(fastify.prisma, fastify.redis);
  const rateLimitService = new RateLimitService(fastify.redis);
  const { ApiKeyService } = await import('../services/api-key.service.js');
  const apiKeyService = new ApiKeyService(fastify.prisma);

  // 2. Decorate instance with services
  fastify.decorate('authService', authService);
  fastify.decorate('rateLimitService', rateLimitService);
  fastify.decorate('apiKeyService', apiKeyService);

  // 3. Update indirection state instead of re-decorating
  authState.authenticate = authenticate;
  authState.requireRole = requireRole;
});


// ============================================================================
// Type Exports
// ============================================================================

export type { UserPayload, UserRole };
