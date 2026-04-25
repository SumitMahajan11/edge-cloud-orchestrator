// ============================================================================
// Shared Environment Validator
// ============================================================================
// Canonical validate-env.ts for all edge-cloud services.
// Each service calls validateEnv(serviceSchema) at startup.
// Throws on missing/invalid vars — prevents silent misconfiguration.
// ============================================================================

import { z } from 'zod';

/**
 * Base env schema shared by all services.
 * JWT_SECRET is always required; services extend this with their own fields.
 */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

/**
 * Validate process.env against a Zod schema.
 * Throws a descriptive Error and exits the process if validation fails.
 * Call this at the very top of each service's startup function.
 *
 * @example
 * const mySchema = baseEnvSchema.extend({ DATABASE_URL: z.string().url() });
 * const env = validateEnv(mySchema);
 */
export function validateEnv<T extends z.ZodTypeAny>(schema: T): z.infer<T> {
  const result = schema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');

    const message = [
      'FATAL: Environment validation failed. Fix these before starting:',
      errors,
      '',
      'The application cannot start with missing or invalid environment variables.',
    ].join('\n');

    console.error(message);
    process.exit(1);
  }

  return result.data;
}

/**
 * Validate only that JWT_SECRET is present and strong enough.
 * Convenience function for services that use SecretManager for other vars.
 */
export function validateJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    console.error('FATAL: JWT_SECRET environment variable is required');
    process.exit(1);
  }

  if (secret.length < 32) {
    console.error('FATAL: JWT_SECRET must be at least 32 characters');
    process.exit(1);
  }

  if (secret.includes('demo') || secret.includes('test') || secret.includes('secret')) {
    if (process.env.NODE_ENV === 'production') {
      console.error('FATAL: JWT_SECRET contains a weak value ("demo"/"test"/"secret") in production');
      process.exit(1);
    }
    console.warn('WARNING: JWT_SECRET contains a weak value — acceptable only in development');
  }

  return secret;
}
