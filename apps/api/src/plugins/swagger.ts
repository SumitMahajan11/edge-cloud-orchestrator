import { FastifyPluginAsync } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

// Load OpenAPI specification from YAML file
function loadOpenAPISpec(): Record<string, unknown> {
  try {
    // Assuming the plugin is in backend/src/plugins/, go up to backend/ then to openapi.yml
    const openapiPath = path.join(__dirname, '../../../openapi.yml');
    const openapiContent = fs.readFileSync(openapiPath, 'utf8');
    const spec = parse(openapiContent) as Record<string, unknown>;

    // Ensure we have the required OpenAPI structure
    if (!spec.openapi || !spec.info || !spec.paths) {
      throw new Error('Invalid OpenAPI specification: missing required fields');
    }

    return spec;
  } catch (error) {
    console.error('Failed to load OpenAPI specification:', error);
    throw new Error('Could not load openapi.yml file');
  }
}

export const swaggerPlugin: FastifyPluginAsync = async (fastify) => {
  // Register Swagger with the loaded OpenAPI spec
  const swagger = await import('@fastify/swagger');
  await fastify.register(swagger.default, {
    mode: 'static',
    specification: {
      document: loadOpenAPISpec() as any, // Type assertion needed for OpenAPI spec
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

  console.log('Swagger plugin registered successfully');
  console.log('Swagger UI available at: /docs');
  console.log('OpenAPI JSON available at: /docs/json');
};
