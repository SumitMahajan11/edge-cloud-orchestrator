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

const versionNegotiationPluginInternal: FastifyPluginAsync<
  VersionNegotiationOptions
> = async (fastify, options) => {
  fastify.log.info('versionNegotiationPlugin executing...');
  const { supportedVersions, defaultVersion } = options;

  fastify.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const headerVersion = request.headers['x-api-version'];

      // Determine requested version from URL prefix if not in header
      // e.g., /v1/tasks -> v1
      const urlParts = request.url.split('/');
      const urlVersion = urlParts.find((p) => /^v\d+$/.test(p));

      const requestedVersion =
        (headerVersion as string) || urlVersion || defaultVersion;
      request.log.debug(
        {
          url: request.url,
          header: headerVersion,
          urlVersion,
          default: defaultVersion,
          requested: requestedVersion,
        },
        'Version negotiation details',
      );

      // Validate if the requested version is supported
      if (!supportedVersions.includes(requestedVersion)) {
        request.log.warn(
          { requestedVersion, supportedVersions },
          'Unsupported API version requested',
        );

        return reply.code(400).send({
          error: 'unsupported_version',
          message: `API version ${requestedVersion} is not supported.`,
          supported: supportedVersions,
        });
      }

      // Ensure header matches URL version if both provided
      if (headerVersion && urlVersion && headerVersion !== urlVersion) {
        request.log.warn(
          { headerVersion, urlVersion },
          'API version mismatch between header and URL',
        );

        return reply.code(400).send({
          error: 'version_mismatch',
          message: `API version in X-API-Version header (${headerVersion}) does not match URL version (${urlVersion}).`,
        });
      }

      // Decorate request with identified version
      request.apiVersion = requestedVersion;
      request.log.debug(
        { apiVersion: request.apiVersion },
        'Set request.apiVersion',
      );
    },
  );

  // Add deprecation headers for v1
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (request.apiVersion === 'v1') {
      request.log.info(
        { url: request.url },
        'Adding deprecation headers to v1 request',
      );
      void reply.header('Deprecation', 'true');

      // Set sunset date to 6 months from now
      const sunsetDate = new Date();
      sunsetDate.setMonth(sunsetDate.getMonth() + 6);
      void reply.header('Sunset', sunsetDate.toUTCString());
    }
    return payload;
  });

  // Decorate Fastify instance with versioning utils
  fastify.decorateRequest('apiVersion', '');
};

declare module 'fastify' {
  interface FastifyRequest {
    apiVersion: string;
  }
}

export const versionNegotiationPlugin = fp(versionNegotiationPluginInternal, {
  name: 'version-negotiation',
});
