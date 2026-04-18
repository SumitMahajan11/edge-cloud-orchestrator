import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

/**
 * API Version Negotiation Plugin
 * Handles X-API-Version header and URL-based version validation.
 */

interface VersionNegotiationOptions {
  supportedVersions: string[];
  defaultVersion: string;
}

const versionNegotiationPlugin: FastifyPluginAsync<VersionNegotiationOptions> = async (
  fastify,
  options
) => {
  const { supportedVersions, defaultVersion } = options;

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const headerVersion = request.headers['x-api-version'];
    
    // Determine requested version from URL prefix if not in header
    // e.g., /v1/tasks -> v1
    const urlParts = request.url.split('/');
    const urlVersion = urlParts.find(p => p.startsWith('v') && supportedVersions.includes(p));

    const requestedVersion = (headerVersion as string) || urlVersion || defaultVersion;

    // Validate if the requested version is supported
    if (!supportedVersions.includes(requestedVersion)) {
      request.log.warn({ requestedVersion, supportedVersions }, 'Unsupported API version requested');
      
      return reply.code(400).send({
        error: 'unsupported_version',
        message: `API version ${requestedVersion} is not supported.`,
        supported: supportedVersions,
      });
    }

    // Ensure header matches URL version if both provided
    if (headerVersion && urlVersion && headerVersion !== urlVersion) {
      request.log.warn({ headerVersion, urlVersion }, 'API version mismatch between header and URL');
      
      return reply.code(400).send({
        error: 'version_mismatch',
        message: `API version in X-API-Version header (${headerVersion}) does not match URL version (${urlVersion}).`,
      });
    }

    // Decorate request with identified version
    request.apiVersion = requestedVersion;
  });

  // Decorate Fastify instance with versioning utils
  fastify.decorateRequest('apiVersion', '');
};

declare module 'fastify' {
  interface FastifyRequest {
    apiVersion: string;
  }
}

export default fp(versionNegotiationPlugin, {
  name: 'version-negotiation',
});
