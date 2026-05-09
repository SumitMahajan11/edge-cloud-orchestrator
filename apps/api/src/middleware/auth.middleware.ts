import { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { enterWithTenantContext } from '@edgecloud/shared-kernel';
import { UserPayload, UserRole } from '../types/fastify';
import { env } from '../config/env';

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const jwtSecret = env.JWT_SECRET;

  try {
    const authHeader = request.headers.authorization;

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
            permissions: result.permissions || [],
          };

          if (result.user.tenantId) {
            enterWithTenantContext(result.user.tenantId);
          }
          return;
        }
      }

      return reply.status(401).send({ error: 'Authentication required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, jwtSecret, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      clockTolerance: 30,
    }) as UserPayload;

    // 1. Future iat check (30s tolerance)
    if (decoded.iat && decoded.iat > (Math.floor(Date.now() / 1000) + 30)) {
      return reply.status(401).send({ error: 'Token issued in the future' });
    }

    // 2. JTI Revocation Check (Redis)
    if (decoded.jti) {
      const redis = (request.server as any).redis;
      if (redis) {
        const isRevoked = await redis.get(`revoked_token:${decoded.jti}`);
        if (isRevoked) {
          return reply.status(401).send({ error: 'Access token has been revoked' });
        }
      }
    }


    request.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      tenantId: decoded.tenantId,
      permissions: decoded.permissions || [],
    };

    if (decoded.tenantId) {
      enterWithTenantContext(decoded.tenantId);
    }
  } catch (error: any) {
    console.error('--- AUTH ERROR ---', error.message);
    return reply.status(401).send({ error: 'Authentication failed' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    if (!roles.includes(request.user.role)) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }
  };
}
