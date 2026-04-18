// ============================================================================
// Environment Configuration Validator
// ============================================================================
//
// Enforces mandatory environment variables at startup
// Prevents insecure default configurations
// Blocks application from running without required secrets
// ============================================================================

import { z } from 'zod';
import { createLogger } from '../lib/logger';

const logger = createLogger('env-validator');

// ============================================================================
// Constants
// ============================================================================

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'PORT',
  'NODE_ENV',
  'REDIS_URL',
  'KAFKA_BROKERS',
  'ENCRYPTION_KEY',
] as const;



// ============================================================================
// Zod Schemas
// ============================================================================

const envSchema = z.object({
  // Required
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  PORT: z.string().regex(/^\d+$/).transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']),
  REDIS_URL: z.string().url(),
  KAFKA_BROKERS: z.string(),
  ENCRYPTION_KEY: z.string().length(64), // AES-256 key

  // Optional with defaults
  LOG_LEVEL: z.string().default('info'),
  METRICS_ENABLED: z.string().optional().default('true'),
  RATE_LIMIT_MAX: z.string().optional().default('100'),
  CORS_ORIGIN: z.string().optional().default('*'),
  SSL_CERT_PATH: z.string().optional(),
  SSL_KEY_PATH: z.string().optional(),
  WEBHOOK_URL: z.string().url().optional(),
  BACKUP_DIR: z.string().optional(),
});

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Check if a required environment variable is missing
 */
function isMissing(envVar: string): boolean {
  return !process.env[envVar] || process.env[envVar] === '';
}

/**
 * Validate that all required environment variables are present
 * Throws error if any are missing - blocks startup
 */
export function validateRequiredEnvVars(): void {
  const missing = REQUIRED_ENV_VARS.filter(isMissing);

  if (missing.length > 0) {
    const errorMsg = [
      '❌ FATAL: Missing required environment variables:',
      ...missing.map((name) => `   - ${name}`),
      '',
      'These must be set before the application can start.',
      'This prevents insecure default configurations.',
    ].join('\n');

    throw new Error(errorMsg);
  }

  logger.info('✅ All required environment variables present');
}

/**
 * Validate environment variable values using Zod schema
 * Provides detailed error messages for invalid formats
 */
export function validateEnvValues(): z.infer<typeof envSchema> {
  try {
    const validated = envSchema.parse(process.env);
    logger.info('✅ Environment variable values validated');
    return validated;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map((err) => {
        const path = err.path.join('.');
        const message = err.message;
        return `   - ${path}: ${message}`;
      });

      const errorMsg = [
        '❌ FATAL: Invalid environment variable values:',
        ...errors,
        '',
        'Fix these values before starting the application.',
      ].join('\n');

      throw new Error(errorMsg);
    }
    throw error;
  }
}

/**
 * Security check: Ensure we're not running as root in production
 */
export function checkNotRunningAsRoot(): void {
  if (process.getuid && process.getuid() === 0) {
    const errorMsg = [
      '❌ FATAL: Refusing to run as root user',
      '',
      'For security reasons, this application cannot run with elevated privileges.',
      'Please use Docker with non-root user or configure proper user permissions.',
      '',
      'Example Dockerfile:',
      '  RUN addgroup -g 1001 nodejs && adduser -S nodejs -u 1001',
      '  USER nodejs',
    ].join('\n');

    throw new Error(errorMsg);
  }

  logger.info('✅ Not running as root user');
}

/**
 * Production-specific security checks
 */
export function validateProductionSecurity(): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const warnings: string[] = [];

  // Check for demo/test credentials
  if (
    process.env.JWT_SECRET?.includes('demo') ||
    process.env.JWT_SECRET?.includes('test')
  ) {
    warnings.push(
      'JWT_SECRET contains "demo" or "test" - weak secret detected',
    );
  }

  // Check encryption key strength
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey || encryptionKey.length < 64) {
    warnings.push('ENCRYPTION_KEY should be 64 characters (AES-256)');
  }

  // Warn about HTTP vs HTTPS
  if (!process.env.SSL_CERT_PATH || !process.env.SSL_KEY_PATH) {
    warnings.push('SSL certificates not configured - consider enabling HTTPS');
  }

  if (warnings.length > 0) {
    logger.warn('⚠️  Production Security Warnings:');
    warnings.forEach((w) => logger.warn(`   - ${w}`));
    logger.warn('   These do not block startup but should be addressed.\n');
  }
}

/**
 * Comprehensive environment validation
 * Call this at application startup
 */
export function validateEnvironment(): void {
  logger.info('\n🔒 Validating environment configuration...\n');

  // Step 1: Check required vars exist
  validateRequiredEnvVars();

  // Step 2: Validate value formats
  validateEnvValues();

  // Step 3: Security checks
  checkNotRunningAsRoot();
  validateProductionSecurity();

  logger.info('✅ Environment validation complete\n');
}

/**
 * Get validated configuration object
 * Use this instead of process.env directly
 */
export function getConfig<T extends z.ZodType>(schema: T): z.infer<T> {
  try {
    return schema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid configuration: ${error.errors.map((e) => e.message).join(', ')}`,
      );
    }
    throw error;
  }
}
