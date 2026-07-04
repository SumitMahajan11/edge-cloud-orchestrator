import { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import {
  enterWithTenantContext,
  RolePermissions,
} from '@edgecloud/shared-kernel';
import { UserPayload, UserRole } from '../types/fastify';
import { env } from '../config/env';

function sendAuthError(
  reply: FastifyReply,
  statusCode: 401 | 403,
  code: string,
  message: string,
): never {
  const requestId =
    (reply.request?.headers?.['x-request-id'] as string) ||
    reply.request?.id ||
    'unknown';
  
  const error = new Error(message) as any;
  error.statusCode = statusCode;
  error.code = code;
  error.details = { requestId, timestamp: new Date().toISOString() };
  
  throw error;
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const jwtSecret = env.JWT_SECRET;

  try {
    const authHeader = request.headers.authorization;
    console.log('[AUTHENTICATE] URL:', request.url, 'authHeader:', authHeader);

    if (!authHeader?.startsWith('Bearer ')) {
      // Check for API Key
      const apiKey = request.headers['x-api-key'] as string;
      if (apiKey) {
        const apiKeyService = (request as any).server.apiKeyService;
        if (!apiKeyService) {
          throw new Error('apiKeyService not decorated on fastify instance');
        }
        const result = await apiKeyService.validateApiKey(apiKey);

        if (result) {
          request.user = {
            id: result.user.id,
            email: result.user.email,
            role: result.user.role,
            tenantId: result.user.tenantId,
            permissions:
              result.permissions || RolePermissions[result.user.role] || [],
          };

          enterWithTenantContext(result.user.tenantId || undefined);
          return;
        }
      }

      return sendAuthError(reply, 401, 'UNAUTHORIZED', 'Authentication required');
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, jwtSecret, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      clockTolerance: 30,
    }) as UserPayload;

    // 1. Future iat check (30s tolerance)
    if (decoded.iat && decoded.iat > Math.floor(Date.now() / 1000) + 30) {
      return sendAuthError(reply, 401, 'TOKEN_FUTURE', 'Token issued in the future');
    }

    // 2. JTI Revocation Check (Redis)
    if (decoded.jti) {
      const redis = (request.server as any).redis;
      if (redis) {
        const isRevoked = await redis.get(`revoked_token:${decoded.jti}`);
        if (isRevoked) {
          return sendAuthError(reply, 401, 'TOKEN_REVOKED', 'Access token has been revoked');
        }
      }
    }

    request.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      tenantId: decoded.tenantId,
      permissions: decoded.permissions || RolePermissions[decoded.role] || [],
    };

    enterWithTenantContext(decoded.tenantId || undefined);
  } catch (error: any) {
    console.error('--- AUTH ERROR ---', error.message);
    return sendAuthError(reply, 401, 'UNAUTHORIZED', 'Authentication failed');
  }
}

export function requireRole(...roles: (UserRole | string)[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return sendAuthError(reply, 401, 'UNAUTHORIZED', 'Authentication required');
    }

    if (!roles.includes(request.user.role)) {
      return sendAuthError(reply, 403, 'FORBIDDEN', 'Insufficient permissions');
    }
  };
}

export function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return sendAuthError(reply, 401, 'UNAUTHORIZED', 'Authentication required');
    }

    // Admin role bypasses permission checks
    if (request.user.role === 'ADMIN') {
      return;
    }

    const permissions = request.user.permissions || [];
    
    // Normalize singular vs plural and legacy permission resource prefixes
    const normalize = (p: string): string => {
      const parts = p.split(':');
      let res = parts[0] || '';
      if (res === 'nodes') res = 'node';
      if (res === 'tasks') res = 'task';
      if (res === 'alerts') res = 'alert';
      if (res === 'costs') res = 'cost';
      if (res === 'webhooks') res = 'webhook';
      if (res === 'schedule') res = 'scheduler';
      if (res === 'metrics') res = 'system';
      parts[0] = res;
      return parts.join(':');
    };

    const normPermission = normalize(permission);
    const [normResource] = normPermission.split(':');
    const normUserPermissions = permissions.map(normalize);

    const hasPermission =
      normUserPermissions.includes(normPermission) ||
      normUserPermissions.includes('*') ||
      (normResource ? normUserPermissions.includes(`${normResource}:*`) : false);

    if (!hasPermission) {
      return sendAuthError(reply, 403, 'FORBIDDEN', 'Insufficient permissions');
    }
  };
}
