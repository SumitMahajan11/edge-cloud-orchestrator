/**
 * Centralized configuration validation
 * Validates all required environment variables at startup
 * Fails fast if any critical configuration is missing
 */

import { Logger } from 'pino';
import { SecretManager } from '@edgecloud/shared-kernel';

export interface ConfigValidation {
  name: string;
  value: string | undefined;
  required: boolean;
  minLength?: number;
  pattern?: RegExp;
  message?: string;
}

/**
 * Validate a single configuration value
 */
function validateConfigItem(item: ConfigValidation): string | null {
  // Check if required
  if (item.required && !item.value) {
    return `${item.name} is required${item.message ? `: ${item.message}` : ''}`;
  }

  // Skip further validation if not required and not set
  if (!item.required && !item.value) {
    return null;
  }

  const value = item.value || '';

  // Check minimum length
  if (item.minLength && value.length < item.minLength) {
    return `${item.name} must be at least ${item.minLength} characters`;
  }

  // Check pattern
  if (item.pattern && !item.pattern.test(value)) {
    return `${item.name} format is invalid${item.message ? `: ${item.message}` : ''}`;
  }

  return null;
}

/**
 * Validate all critical configuration
 * Throws error if any validation fails
 */
export async function validateConfiguration(
  logger: Logger,
  secretManager: SecretManager,
): Promise<void> {
  const nodeEnv = (await secretManager.getSecret('NODE_ENV')) || 'development';
  const isDevelopment = nodeEnv !== 'production';
  const isProduction = !isDevelopment;

  const validations: ConfigValidation[] = [
    // Critical security configs - always required
    {
      name: 'JWT_SECRET',
      value: await secretManager.getSecret('JWT_SECRET'),
      required: true,
      minLength: 32,
      message: 'Must be at least 32 characters for security',
    },
    {
      name: 'ENCRYPTION_KEY',
      value: await secretManager.getSecret('ENCRYPTION_KEY'),
      required: true,
      minLength: 32,
      message: 'Must be at least 32 characters for AES-256 encryption',
    },

    // Production-only requirements
    {
      name: 'DATABASE_URL',
      value: await secretManager.getSecret('DATABASE_URL'),
      required: isProduction,
      pattern: /^postgresql:\/\//,
      message: 'Must be a valid PostgreSQL connection string',
    },

    // Certificate paths - required if mTLS enabled
    {
      name: 'MTLS_CA_CERT',
      value: await secretManager.getSecret('MTLS_CA_CERT'),
      required:
        (await secretManager.getSecret('MTLS_ENABLED')) === 'true' &&
        isProduction,
      message: 'Required when MTLS_ENABLED is true',
    },
  ];

  const errors: string[] = [];

  for (const item of validations) {
    const error = validateConfigItem(item);
    if (error) {
      errors.push(error);
    }
  }

  // Additional production checks
  if (isProduction) {
    if ((await secretManager.getSecret('FORCE_MOCK_DB')) === 'true') {
      errors.push('FORCE_MOCK_DB cannot be true in production');
    }

    if ((await secretManager.getSecret('ENABLE_DEMO_CREDENTIALS')) === 'true') {
      errors.push('ENABLE_DEMO_CREDENTIALS cannot be true in production');
    }
  }

  // Log and throw if errors found
  if (errors.length > 0) {
    for (const error of errors) {
      logger.fatal(`FATAL CONFIG ERROR: ${error}`);
    }
    throw new Error(
      `Configuration validation failed with ${errors.length} error(s)`,
    );
  }

  logger.info(
    `✅ Configuration validation passed using ${secretManager.constructor.name}`,
  );
}
