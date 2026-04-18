import { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Utility for handling API deprecation and sunsetting.
 * Follows IETF draft-ietf-httpapi-deprecation-header and draft-ietf-httpapi-sunset-header.
 */

export interface DeprecationOptions {
  deprecationDate?: string; // ISO 8601 date when deprecation was announced
  sunsetDate?: string;      // ISO 8601 date when the endpoint will be removed
  link?: string;            // URL providing more information
}

/**
 * Sets deprecation headers on the response.
 */
export function setDeprecationHeaders(
  reply: FastifyReply,
  options: DeprecationOptions
) {
  if (options.deprecationDate) {
    reply.header('Deprecation', options.deprecationDate);
  } else {
    reply.header('Deprecation', 'true');
  }

  if (options.sunsetDate) {
    reply.header('Sunset', options.sunsetDate);
  }

  if (options.link) {
    reply.header('Link', `<${options.link}>; rel="deprecation"; type="text/html"`);
  }
}

/**
 * Higher-order function to wrap a route handler with deprecation logic.
 */
export function deprecated(
  options: DeprecationOptions,
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<any>
) {
  return async function(request: FastifyRequest, reply: FastifyReply) {
    // Log warning (once per endpoint/version in a real system we might use a cache)
    request.log.warn(
      { url: request.url, ...options },
      'Accessing deprecated API endpoint'
    );

    setDeprecationHeaders(reply, options);
    
    return handler(request, reply);
  };
}
