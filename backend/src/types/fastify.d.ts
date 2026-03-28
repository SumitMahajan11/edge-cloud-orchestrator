// ============================================================================
// Fastify Type Extensions
// ============================================================================
// 
// This file provides proper TypeScript support for:
// - @fastify/jwt payload typing
// - Custom FastifyInstance decorations
// - Zod schema integration
// - Typed request/reply objects
// ============================================================================

import { PrismaClient } from '@prisma/client'
import Redis from 'ioredis'
import { WebSocketManager } from '../services/websocket-manager'
import { HeartbeatMonitor } from '../services/heartbeat-monitor'
import { TaskScheduler } from '../services/task-scheduler'
import type { FastifyRequest, FastifyReply, RouteHandlerMethod } from 'fastify'
import type { z } from 'zod'

// ============================================================================
// User Types
// ============================================================================

export type UserRole = 'ADMIN' | 'OPERATOR' | 'VIEWER'

export interface UserPayload {
  id: string
  email: string
  role: UserRole
}

// ============================================================================
// JWT Types (extends @fastify/jwt)
// ============================================================================

declare module '@fastify/jwt' {
  // This tells @fastify/jwt what type to expect for JWT payloads
  // It affects fastify.jwt.sign() and fastify.jwt.verify()
  interface FastifyJWT {
    // Payload type when signing
    payload: UserPayload
    // Payload type after verification (same as payload in this case)
    user: UserPayload
  }
}

// ============================================================================
// Fastify Instance Extensions
// ============================================================================

declare module 'fastify' {
  interface FastifyInstance {
    // Decorated services
    prisma: PrismaClient
    redis: Redis
    wsManager: WebSocketManager
    heartbeatMonitor: HeartbeatMonitor
    taskScheduler: TaskScheduler
    
    // Auth decorators
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireRole: (...roles: UserRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }

  // ============================================================================
  // Request Extensions
  // ============================================================================
  
  interface FastifyRequest {
    /**
     * Authenticated user payload.
     * Populated by fastify.authenticate() middleware.
     * 
     * Type is narrowed from @fastify/jwt's FastifyJWT interface.
     */
    user: UserPayload
  }
}

// ============================================================================
// Typed Route Handler Helpers
// ============================================================================

/**
 * Generic route handler type with typed query, params, body, and headers
 */
export type TypedRouteHandler<
  Query = Record<string, unknown>,
  Params = Record<string, unknown>,
  Body = Record<string, unknown>,
  Headers = Record<string, unknown>,
> = (
  request: FastifyRequest<{
    Querystring: Query
    Params: Params
    Body: Body
    Headers: Headers
  }>,
  reply: FastifyReply
) => Promise<unknown> | unknown

/**
 * Helper type for extracting Zod schema types
 */
export type InferSchema<T> = T extends z.ZodType<infer U> ? U : never

/**
 * Route options with Zod schema validation
 */
export interface ZodRouteOptions<
  QuerySchema extends z.ZodType = z.ZodVoid,
  ParamsSchema extends z.ZodType = z.ZodVoid,
  BodySchema extends z.ZodType = z.ZodVoid,
> {
  querystring?: QuerySchema
  params?: ParamsSchema
  body?: BodySchema
}

// ============================================================================
// Typed Fastify Route Builder (Optional Helper)
// ============================================================================

/**
 * Creates a typed route handler with inferred types from Zod schemas.
 * 
 * Usage:
 * ```typescript
 * const getTasks = createTypedHandler({
 *   query: taskQuerySchema,
 *   handler: async (request, reply) => {
 *     // request.query is fully typed
 *     const { status, page, limit } = request.query
 *   }
 * })
 * ```
 */
export function createTypedHandler<
  QuerySchema extends z.ZodType,
  ParamsSchema extends z.ZodType,
  BodySchema extends z.ZodType,
>(options: {
  query?: QuerySchema
  params?: ParamsSchema
  body?: BodySchema
  preHandler?: FastifyRequest['routeConfig']['preHandler']
  handler: (
    request: FastifyRequest<{
      Querystring: InferSchema<QuerySchema>
      Params: InferSchema<ParamsSchema>
      Body: InferSchema<BodySchema>
    }>,
    reply: FastifyReply
  ) => Promise<unknown> | unknown
}): RouteHandlerMethod {
  return async (request, reply) => {
    return options.handler(
      request as FastifyRequest<{
        Querystring: InferSchema<QuerySchema>
        Params: InferSchema<ParamsSchema>
        Body: InferSchema<BodySchema>
      }>,
      reply
    )
  }
}
