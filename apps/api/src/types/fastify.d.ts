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

import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { WebSocketManager } from '../services/websocket-manager';
import { HeartbeatMonitor } from '../services/heartbeat-monitor';
import { TaskScheduler } from '../services/task-scheduler';
import type { FastifyRequest, FastifyReply, RouteHandlerMethod } from 'fastify';
import type { z } from 'zod';

// ============================================================================
// User Types
// ============================================================================

declare const __tenantIdBrand: unique symbol;
export type TenantId = string & { readonly __brand: typeof __tenantIdBrand };

export type UserRole = 'ADMIN' | 'OPERATOR' | 'VIEWER' | 'SERVICE';

export interface UserPayload {
  id: string;
  email: string;
  role: UserRole;
  tenantId?: string | undefined;
  permissions: string[];
  jti?: string;
  iat?: number;
  iss?: string;
  aud?: string;
}

// ============================================================================
// JWT Types (extends @fastify/jwt)
// ============================================================================

declare module '@fastify/jwt' {
  // This tells @fastify/jwt what type to expect for JWT payloads
  // It affects fastify.jwt.sign() and fastify.jwt.verify()
  interface FastifyJWT {
    // Payload type when signing
    payload: UserPayload;
    // Payload type after verification (same as payload in this case)
    user: UserPayload;
  }
}

// ============================================================================
// Fastify Instance Extensions
// ============================================================================

declare module 'fastify' {
  interface FastifyInstance {
    // Decorated services
    prisma: PrismaClient;
    redis: Redis;
    wsManager: WebSocketManager;
    heartbeatMonitor: HeartbeatMonitor;
    taskScheduler: TaskScheduler;
    idempotencyService: import('../services/idempotency-service.js').IdempotencyService;
    schedulerRateLimiter: import('../services/scheduler-rate-limiter.js').SchedulerRateLimiter;
    authService: import('../services/auth.service.js').AuthService;
    rateLimitService: import('../services/rate-limit.service.js').RateLimitService;
    apiKeyService: import('../services/api-key.service.js').ApiKeyService;
    priorityScheduler: import('../services/priority-scheduler.js').PriorityScheduler;
    backpressureController: import('../services/backpressure-controller.js').BackpressureController;
    gracefulDegradation: import('../services/graceful-degradation.js').GracefulDegradationService;
    alerting: import('../services/alerting-service.js').AlertingService;
    autoHealer: import('../services/auto-healer.js').AutoHealer;
    healthMonitor: import('../services/health-monitor.js').HealthMonitor;
    slaMonitor: import('../services/sla-monitor.js').SLAMonitor;
    costOptimizer: import('../services/cost-optimizer.js').CostOptimizer;
    sagaOrchestrator: import('@edgecloud/saga').SagaOrchestrator;
    k8sOperator?: import('../services/kubernetes-operator.js').EdgeCloudOperator;
    modelStorage: import('@edgecloud/ml-scheduler').ModelStorageService;
    coldStartHandler: import('../services/cold-start-handler.js').ColdStartHandler;
    workflowEngine: import('../services/workflow-engine.js').WorkflowEngine;
    dbCircuitBreaker: import('@edgecloud/circuit-breaker').CircuitBreaker;

    // Auth decorators
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    requireRole: (
      ...roles: (UserRole | string)[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      permission: string,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
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
    user: UserPayload;
    tPrisma: PrismaClient;
    apiVersion: string;
  }

  interface FastifyContextConfig {
    public?: boolean;
    rateLimit?: {
      max?: number;
      timeWindow?: number;
    };
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
    Querystring: Query;
    Params: Params;
    Body: Body;
    Headers: Headers;
  }>,
  reply: FastifyReply,
) => Promise<unknown> | unknown;

/**
 * Helper type for extracting Zod schema types
 */
export type InferSchema<T> = T extends z.ZodType<infer U> ? U : never;

/**
 * Route options with Zod schema validation
 */
export interface ZodRouteOptions<
  QuerySchema extends z.ZodType = z.ZodVoid,
  ParamsSchema extends z.ZodType = z.ZodVoid,
  BodySchema extends z.ZodType = z.ZodVoid,
> {
  querystring?: QuerySchema;
  params?: ParamsSchema;
  body?: BodySchema;
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
  query?: QuerySchema;
  params?: ParamsSchema;
  body?: BodySchema;
  preHandler?: FastifyRequest['routeConfig']['preHandler'];
  handler: (
    request: FastifyRequest<{
      Querystring: InferSchema<QuerySchema>;
      Params: InferSchema<ParamsSchema>;
      Body: InferSchema<BodySchema>;
    }>,
    reply: FastifyReply,
  ) => Promise<unknown> | unknown;
}): RouteHandlerMethod {
  return async (request, reply) => {
    return options.handler(
      request as FastifyRequest<{
        Querystring: InferSchema<QuerySchema>;
        Params: InferSchema<ParamsSchema>;
        Body: InferSchema<BodySchema>;
      }>,
      reply,
    );
  };
}
