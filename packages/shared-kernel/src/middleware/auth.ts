import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { RolePermissions } from "../auth/permissions.js";

export interface AuthUser {
  id: string;
  email: string;
  role: "ADMIN" | "OPERATOR" | "VIEWER" | "SERVICE";
  permissions: string[];
  tenantId?: string | undefined;
  region?: string | undefined;
}

export interface AuthConfig {
  jwtSecret: string;
  serviceToken?: string;
  skipPaths?: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
    serviceAuth?: boolean;
  }
}

export function createAuthMiddleware(config: AuthConfig) {
  const skipPaths = config.skipPaths || ["/health", "/metrics", "/ready"];

  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    // Skip authentication for health/metrics endpoints
    if (skipPaths.some((path) => request.url.startsWith(path))) {
      return;
    }

    const authHeader = request.headers.authorization;
    const serviceAuth = request.headers["x-service-auth"] as string;

    // Service-to-service authentication
    if (serviceAuth && config.serviceToken) {
      if (serviceAuth === config.serviceToken) {
        request.serviceAuth = true;
        request.user = {
          id: "service",
          email: "service@internal",
          role: "SERVICE",
          permissions: ["*"],
        };
        return;
      }
    }

    // JWT authentication
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);

      try {
        const decoded = jwt.verify(token, config.jwtSecret) as AuthUser;
        request.user = decoded;
        return;
      } catch (error) {
        return reply.status(401).send({
          error: "Invalid or expired token",
          code: "AUTH_INVALID_TOKEN",
        });
      }
    }

    // API Key authentication (for edge agents)
    const apiKey = request.headers["x-api-key"] as string;
    if (apiKey) {
      // Validate API key format and extract info
      if (apiKey.startsWith("ec_agent_")) {
        request.user = {
          id: apiKey,
          email: `agent@${request.ip}`,
          role: "SERVICE",
          permissions: ["tasks:execute", "nodes:heartbeat"],
        };
        return;
      }
    }

    return reply.status(401).send({
      error: "Authentication required",
      code: "AUTH_REQUIRED",
    });
  };
}

// Role-based access control middleware
export function requireRole(...roles: string[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.status(401).send({
        error: "Authentication required",
        code: "AUTH_REQUIRED",
      });
    }

    if (!roles.includes(request.user.role) && request.user.role !== "ADMIN") {
      return reply.status(403).send({
        error: "Insufficient permissions",
        code: "AUTH_FORBIDDEN",
        required: roles,
      });
    }
  };
}

// Permission-based access control
export function requirePermission(permission: string) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.status(401).send({
        error: "Authentication required",
        code: "AUTH_REQUIRED",
      });
    }

    const permissions = request.user.permissions || [];
    
    // Normalize singular vs plural and legacy permission resource prefixes
    const normalize = (p: string): string => {
      const parts = p.split(':');
      let res = parts[0] || '';
      if (res === 'nodes') res = 'node';
      if (res === 'tasks') res = 'task';
      if (res === 'alerts') res = 'alert';
      if (res === 'costs') res = 'cost';
      if (res === 'webhooks') res = 'webhook';
      if (res === 'schedule') res = 'scheduler';
      if (res === 'metrics') res = 'system';
      parts[0] = res;
      return parts.join(':');
    };

    const normPermission = normalize(permission);
    const [normResource] = normPermission.split(':');
    const normUserPermissions = permissions.map(normalize);

    const hasPermission =
      normUserPermissions.includes(normPermission) ||
      normUserPermissions.includes('*') ||
      (normResource ? normUserPermissions.includes(`${normResource}:*`) : false);

    if (!hasPermission) {
      return reply.status(403).send({
        error: "Permission denied",
        code: "AUTH_FORBIDDEN",
        required: permission,
      });
    }
  };
}

// Region-based access control
export function requireRegion() {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.status(401).send({
        error: "Authentication required",
        code: "AUTH_REQUIRED",
      });
    }

    // Admin can access all regions
    if (request.user.role === "ADMIN") {
      return;
    }

    const targetRegion =
      (request.params as any)?.region || (request.query as any)?.region;

    if (
      targetRegion &&
      request.user.region &&
      targetRegion !== request.user.region
    ) {
      return reply.status(403).send({
        error: "Region access denied",
        code: "AUTH_REGION_FORBIDDEN",
      });
    }
  };
}

// Generate JWT token (for login)
export function generateToken(
  user: Omit<AuthUser, "permissions">,
  secret: string,
  expiresIn: string = "1h",
): string {
  const permissions = getPermissionsForRole(user.role);
  return jwt.sign({ ...user, permissions }, secret, {
    expiresIn: expiresIn as any,
  });
}

function getPermissionsForRole(role: string): string[] {
  const upperRole = role.toUpperCase();
  if (upperRole === "ADMIN") {
    return ["*"];
  }
  if (RolePermissions[upperRole]) {
    return RolePermissions[upperRole] as string[];
  }
  const legacyPermissions: Record<string, string[]> = {
    SERVICE: [
      "task:execute",
      "tasks:execute",
      "node:heartbeat",
      "nodes:heartbeat",
      "system:write",
      "metrics:write",
    ],
  };
  return legacyPermissions[upperRole] || [];
}
