// ============================================================================
// Authentication Plugin
// ============================================================================
// 
// Provides JWT and API key authentication for Fastify routes.
// Uses types from src/types/fastify.d.ts
// ============================================================================

import fp from 'fastify-plugin'
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import type { UserRole, UserPayload } from '../types/fastify'

const JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret'

export const authPlugin = fp(async (fastify: FastifyInstance) => {
  // ==========================================================================
  // Authentication Middleware
  // ==========================================================================
  
  fastify.decorate('authenticate', async function (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      // Check for API key first (service-to-service auth)
      const apiKey = request.headers['x-api-key']
      if (apiKey && typeof apiKey === 'string') {
        const key = await fastify.prisma.apiKey.findUnique({
          where: { key: apiKey },
          include: { user: true },
        })
        
        if (!key || (key.expiresAt && key.expiresAt < new Date())) {
          return reply.status(401).send({ error: 'Invalid or expired API key' })
        }
        
        // Update last used timestamp
        await fastify.prisma.apiKey.update({
          where: { id: key.id },
          data: { lastUsedAt: new Date() },
        })
        
        // Set user payload (typed via FastifyRequest extension)
        request.user = {
          id: key.user.id,
          email: key.user.email,
          role: key.user.role as UserRole,
        }
        return
      }
      
      // Check for Bearer token (user auth)
      const authHeader = request.headers.authorization
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'No authentication token provided' })
      }
      
      const token = authHeader.replace('Bearer ', '')
      
      // Validate JWT token
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as UserPayload & { permissions?: string[] }
        request.user = {
          id: decoded.id,
          email: decoded.email,
          role: decoded.role as UserRole,
        }
      } catch (jwtError) {
        return reply.status(401).send({ error: 'Invalid or expired token' })
      }
    } catch (error) {
      request.log.error({ error }, 'Authentication failed')
      return reply.status(401).send({ error: 'Authentication failed' })
    }
  })
  
  // ==========================================================================
  // Role-Based Authorization Middleware
  // ==========================================================================
  
  fastify.decorate('requireRole', function (
    this: FastifyInstance,
    ...roles: UserRole[]
  ) {
    return async function (
      request: FastifyRequest,
      reply: FastifyReply
    ): Promise<void> {
      // request.user is guaranteed by authenticate preHandler
      if (!request.user) {
        return reply.status(401).send({ error: 'Not authenticated' })
      }
      
      if (!roles.includes(request.user.role)) {
        return reply.status(403).send({
          error: 'Insufficient permissions',
          required: roles,
          current: request.user.role,
        })
      }
    }
  })
})

// ============================================================================
// Type Exports
// ============================================================================

export type { UserRole, UserPayload }
