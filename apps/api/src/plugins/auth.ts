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

export const authPlugin = fp(async (fastify: FastifyInstance) => {
  // 1. Instantiate Services
  // Note: fastify.prisma and fastify.redis are assumed to be decorated already
  const authService = new AuthService(fastify.prisma);
  const rateLimitService = new RateLimitService(fastify.redis);

  // 2. Decorate instance with services
  fastify.decorate('authService', authService);
  fastify.decorate('rateLimitService', rateLimitService);

  // 3. Decorate instance with middleware
  fastify.decorate('authenticate', authenticate);
  fastify.decorate('requireRole', requireRole);
});

// ============================================================================
// Type Exports
// ============================================================================

export type { UserPayload, UserRole };
