import fp from 'fastify-plugin';
import { enterWithTenantContext } from '@edgecloud/shared-kernel';

export const tenantContextPlugin = fp(async (fastify) => {
  // We use a preHandler hook to set the tenant context after authentication.
  // This ensures that request.user.tenantId is available.
  fastify.addHook('preHandler', async (request: any, _reply) => {
    const tenantId = request.user?.tenantId;
    
    enterWithTenantContext(tenantId || undefined);
  });
});
