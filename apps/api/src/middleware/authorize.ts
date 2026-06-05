// ============================================================================
// Authorization Middleware - RBAC Enforcement
// ============================================================================
//
// Provides role-based access control that MUST be applied to all protected routes.
// This middleware enforces authorization at the route level.
// ============================================================================

import { FastifyRequest, FastifyReply } from 'fastify';
import type { UserRole } from '../types/fastify';
import { RolePermissions, type Permission } from '@edgecloud/shared-kernel';

export class AuthorizationError extends Error {
  constructor(
    message: string,
    public requiredRoles: string[],
    public userRole?: string,
  ) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/**
 * Require specific roles for route access
 *
 * @param roles - Allowed roles for this route
 * @returns Fastify preHandler function
 *
 * @example
 * ```typescript
 * // Admin-only route
 * fastify.post('/api/admin/users', {
 *   preHandler: [authorize('admin')]
 * }, handler);
 *
 * // Multiple roles allowed
 * fastify.get('/api/tasks', {
 *   preHandler: [authorize('admin', 'operator', 'user')]
 * }, handler);
 * ```
 */
export function authorize(...roles: UserRole[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    // Check if user is authenticated
    if (!request.user) {
      return reply.status(401).send({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    // Admin can access everything (super user)
    if (request.user.role === 'ADMIN') {
      return;
    }

    // Check if user has required role
    if (!roles.includes(request.user.role)) {
      throw new AuthorizationError(
        `Access denied. Required roles: ${roles.join(', ')}. Your role: ${request.user.role}`,
        roles,
        request.user.role,
      );
    }
  };
}

/**
 * Require specific permissions for route access
 * More granular than role-based checks
 *
 * @param permissions - Required permissions
 * @returns Fastify preHandler function
 */
export function requirePermissions(...permissions: string[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.status(401).send({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    // Admin bypasses permission checks
    if (request.user.role === 'ADMIN') {
      return;
    }

    const userPermissions: Permission[] =
      request.user.permissions?.length
        ? (request.user.permissions as Permission[])
        : (RolePermissions as Record<string, Permission[]>)[request.user.role] ?? [];

    const hasPermission = permissions.every((p) =>
      userPermissions.includes(p as Permission)
    );

    if (!hasPermission) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions',
          statusCode: 403,
        }
      });
    }
  };
}

/**
 * Resource ownership check
 * Ensures user can only access their own resources
 *
 * @param resourceIdParam - Name of URL parameter containing resource ID
 * @param getUserFromResource - Function to get owner ID from resource
 * @returns Fastify preHandler function
 */
export function requireOwnership(
  resourceIdParam: string,
  getUserFromResource: (resourceId: string) => Promise<string | null>,
) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.status(401).send({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    const resourceId = (request.params as Record<string, string>)[
      resourceIdParam
    ];

    if (!resourceId) {
      return reply.status(400).send({
        error: 'Resource ID required',
        code: 'INVALID_PARAM',
      });
    }

    const ownerId = await getUserFromResource(resourceId);

    if (!ownerId) {
      return reply.status(404).send({
        error: 'Resource not found',
        code: 'NOT_FOUND',
      });
    }

    // Admin can access any resource
    if (request.user.role === 'ADMIN') {
      return;
    }

    // Check if user owns the resource
    if (request.user.id !== ownerId) {
      throw new AuthorizationError(
        'You can only access your own resources',
        ['owner'],
        request.user.role,
      );
    }
  };
}
