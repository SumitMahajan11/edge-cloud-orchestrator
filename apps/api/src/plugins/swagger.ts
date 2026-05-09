import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

const swaggerPluginInternal: FastifyPluginAsync = async (fastify) => {
  // Register Swagger with dynamic generation
  const swagger = await import('@fastify/swagger');
  await fastify.register(swagger.default, {
    openapi: {
      info: {
        title: 'Edge-Cloud Orchestrator API',
        description: 'Production API documentation for the Edge-Cloud Orchestrator Control Plane',
        version: '1.0.0',
      },
      servers: [
        {
          url: 'http://localhost:3090',
          description: 'Development server',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
        schemas: {
          ErrorSchema: {
            type: 'object',
            required: ['code', 'message', 'requestId', 'timestamp'],
            properties: {
              code: { type: 'string', description: 'Machine-readable error code' },
              message: { type: 'string', description: 'Human-readable error description' },
              requestId: { type: 'string', description: 'Unique request ID' },
              timestamp: { type: 'string', format: 'date-time', description: 'ISO 8601 timestamp' },
              details: { type: 'object', description: 'Optional error details' } as any,
              stack: { type: 'string', description: 'Error stack trace (non-production only)' },
            },
          },
        },
      },
    },
  });

  // Register Swagger UI
  const swaggerUi = await import('@fastify/swagger-ui');
  await fastify.register(swaggerUi.default, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      tryItOutEnabled: true,
    },
    staticCSP: true,
    transformStaticCSP: (header: string) => header,
  });

  fastify.log.info('Swagger plugin registered (Dynamic Mode)');
  fastify.log.info('Swagger UI available at: /docs');
};

export const swaggerPlugin = fp(swaggerPluginInternal, {
  name: 'swagger-plugin',
});

