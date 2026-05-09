import { FastifyPluginAsync } from 'fastify';
import adminRoutes from './admin.js';
import alertRoutes from './alerts.js';
import authRoutes from './auth.js';
import carbonRoutes from './carbon.js';
import costRoutes from './cost.js';
import flRoutes from './federated-learning.js';
import metricsRoutes from './metrics.js';
import nodeRoutes from './nodes.js';
import taskRoutes from './tasks.js';
import webhookRoutes from './webhooks.js';
import workflowRoutes from './workflows.js';
import agentRoutes from './agents.js';
import policyRoutes from './policies.js';
import logRoutes from './logs.js';
import systemRoutes from './system.js';
import schedulerRoutes from './scheduler.js';
import mlRoutes from './ml.js';

/**
 * API V2 Route Manifest
 * Active version as of v4.0.0 orchestrator.
 */
const v2Routes: FastifyPluginAsync = async (fastify) => {
  // Register each route module
  // Note: These prefixes are relative to the parent prefix (/v2)
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
  await fastify.register(policyRoutes, { prefix: '/policies' });
  await fastify.register(agentRoutes, { prefix: '/agents' });
  await fastify.register(logRoutes, { prefix: '/logs' });
  await fastify.register(systemRoutes, { prefix: '/system' });
  await fastify.register(schedulerRoutes, { prefix: '/scheduler' });
  await fastify.register(mlRoutes, { prefix: '/ml' });
  const resilienceRoutes = (await import('./resilience.js')).default;
  await fastify.register(resilienceRoutes, { prefix: '/circuit-breakers' });
  const apiKeyRoutes = (await import('./api-keys.js')).default;
  await fastify.register(apiKeyRoutes, { prefix: '/api-keys' });

  // V2 specific status
  fastify.get('/status', { config: { public: true } }, async () => ({
    status: 'v2-active',
    message: 'Welcome to API v2. Production version stable.'
  }));
};

export default v2Routes;
export { v2Routes };

