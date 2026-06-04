import jwt from 'jsonwebtoken';
import { RolePermissions, type Permission } from '@edgecloud/shared-kernel';

const JWT_SECRET = 'a'.repeat(32); // Fixed test secret — does not contain weak words

interface TokenOptions {
  id?: string;
  email?: string;
  role?: string;
  tenantId?: string;
  permissions?: Permission[];
  expiresIn?: any;
}

/**
 * Generate a valid JWT token for testing.
 * Automatically populates permissions based on the role unless explicitly overridden.
 * Includes the required issuer and audience claims that the middleware verifies.
 */
export function generateTestToken(options: TokenOptions = {}): string {
  const role = options.role || 'USER';
  
  return jwt.sign(
    {
      id: options.id || '00000000-0000-0000-0000-000000000001',
      email: options.email || 'test@example.com',
      role,
      tenantId: options.tenantId || '00000000-0000-0000-0000-000000000002',
      // Always populate permissions from the role if not explicitly provided:
      permissions: options.permissions || (RolePermissions as Record<string, Permission[]>)[role] || [],
    },
    JWT_SECRET,
    {
      issuer: 'edge-cloud-orchestrator',
      audience: 'edge-cloud-clients',
      expiresIn: options.expiresIn || '1h',
    }
  );
}

export { JWT_SECRET as TEST_JWT_SECRET };
