/**
 * Simple encryption utility for sensitive database fields
 * Uses AES-256-GCM for authenticated encryption
 *
 * NOTE: For production, consider using a KMS (AWS KMS, Azure Key Vault, HashiCorp Vault)
 * This implementation provides a practical middle-ground for immediate security improvement
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from 'crypto';

import { env } from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

/**
 * Derive encryption key from environment variable
 * Uses scrypt for key derivation
 */
function getEncryptionKey(): Buffer {
  const encryptionKey = env.ENCRYPTION_KEY;

  // Use scrypt to derive a proper 256-bit key
  return scryptSync(encryptionKey, 'edgecloud-salt', 32);
}

/**
 * Encrypt sensitive data
 * @param plaintext - Data to encrypt
 * @returns Encrypted string in format: salt:iv:authTag:ciphertext (base64)
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    return plaintext;
  }

  try {
    const key = getEncryptionKey();
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    // Combine salt + iv + authTag + ciphertext
    const result = Buffer.concat([
      salt,
      iv,
      authTag,
      Buffer.from(encrypted, 'base64'),
    ]).toString('base64');

    return result;
  } catch (error) {
    throw new Error(`Encryption failed: ${(error as Error).message}`);
  }
}

/**
 * Decrypt sensitive data
 * @param ciphertext - Encrypted string in format: salt:iv:authTag:ciphertext (base64)
 * @returns Decrypted plaintext
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) {
    return ciphertext;
  }

  try {
    const key = getEncryptionKey();
    const buffer = Buffer.from(ciphertext, 'base64');

    // Extract components
    const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = buffer.subarray(
      SALT_LENGTH + IV_LENGTH,
      SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
    );
    const encrypted = buffer.subarray(
      SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
    );

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(
      encrypted.toString('base64'),
      'base64',
      'utf8',
    );
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    throw new Error(`Decryption failed: ${(error as Error).message}`);
  }
}

/**
 * Check if a string appears to be encrypted (basic heuristic)
 * @param value - String to check
 * @returns true if likely encrypted
 */
export function isEncrypted(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  try {
    const buffer = Buffer.from(value, 'base64');
    // Check if length matches expected encrypted format
    return buffer.length >= SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1;
  } catch {
    return false;
  }
}

/**
 * Hash sensitive data for comparison (one-way)
 * Use for fields that don't need decryption (e.g., API key hashes)
 * @param data - Data to hash
 * @returns SHA-256 hash
 */
export function hashSensitive(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}
