import { FastifyPluginAsync } from 'fastify';

import adminRoutes from './admin';
import alertRoutes from './alerts';
import authRoutes from './auth';
import carbonRoutes from './carbon';
import costRoutes from './cost';
import flRoutes from './federated-learning';
import metricsRoutes from './metrics';
import nodeRoutes from './nodes';
import taskRoutes from './tasks';
import webhookRoutes from './webhooks';
import workflowRoutes from './workflows';

/**
 * API V1 Route Manifest
 * Groups all V1 routes for versioned registration.
 */
const v1Routes: FastifyPluginAsync = async (fastify) => {
  // Add deprecation headers to all v1 routes
  fastify.addHook('onRequest', async (request, reply) => {
    void reply.header('Deprecation', 'true');
    void reply.header('Sunset', 'Sat, 31 Dec 2026 23:59:59 GMT');
    const v2Path = request.url.replace(/^\/api\/v1/, '/api/v2');
    void reply.header('Link', `<${v2Path}>; rel="successor-version"`);
  });

  // Register each route module
  // Note: These prefixes are relative to the parent prefix (/v1)
  await fastify.register(authRoutes, { prefix: '/auth' });
  await fastify.register(nodeRoutes, { prefix: '/nodes' });
  await fastify.register(taskRoutes, { prefix: '/tasks' });
  await fastify.register(workflowRoutes, { prefix: '/workflows' });
  await fastify.register(webhookRoutes, { prefix: '/webhooks' });
  await fastify.register(metricsRoutes, { prefix: '/metrics' });
  await fastify.register(flRoutes, { prefix: '/fl' });
  await fastify.register(costRoutes, { prefix: '/cost' });
  await fastify.register(carbonRoutes, { prefix: '/carbon' });
  await fastify.register(adminRoutes, { prefix: '/admin' });
  await fastify.register(alertRoutes, { prefix: '/alerts' });
};

export default v1Routes;
export { v1Routes };
