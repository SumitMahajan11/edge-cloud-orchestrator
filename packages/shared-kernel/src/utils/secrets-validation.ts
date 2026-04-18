import { SecretManager } from '../secrets/SecretManager';

/**
 * Validates that all required secrets are present.
 * Throws an error if any required secret is missing.
 */
export async function validateRequiredSecrets(
  secretManager: SecretManager,
  requiredKeys: string[],
  serviceName: string
): Promise<void> {
  const missing: string[] = [];

  for (const key of requiredKeys) {
    const value = await secretManager.getSecret(key);
    if (value === undefined || value === '') {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    const errorMsg = `[${serviceName}] Startup failed: Missing required secrets: ${missing.join(', ')}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
}
