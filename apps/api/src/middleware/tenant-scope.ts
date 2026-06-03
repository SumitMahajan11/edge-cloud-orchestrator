import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { enterWithTenantContext } from '@edgecloud/shared-kernel';

/**
 * Middleware to enforce tenant scoping at the request level.
 * Uses enterWithTenantContext to scope context to the request execution chain.
 */
export const tenantScopePlugin: FastifyPluginAsync = fp(async (fastify: FastifyInstance) => {
  fastify.addHook('onRequest', (request, _reply, done) => {
    // 1. Get tenantId from request (already decoded by JWT plugin if present)
    // Note: We might need to decode it here if onRequest runs before auth
    // But fastify-jwt usually populates request.user in preHandler or earlier if configured.
    
    // In our case, we'll try to get it from the header if not already decoded
    const authHeader = request.headers.authorization;
    let tenantId: string | undefined = (request.user as any)?.tenantId;

    if (!tenantId && authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const decoded = fastify.jwt.decode(token) as any;
        tenantId = decoded?.tenantId;
      } catch (err) {
        // Ignore decode errors here, let auth middleware handle it
      }
    }

    enterWithTenantContext(tenantId || undefined);
    done();
  });
});
