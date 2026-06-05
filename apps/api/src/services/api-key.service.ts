import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';

export class ApiKeyService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Creates a new API key for a user.
   * Returns the plaintext key (only time it's visible).
   */
  async createApiKey(
    userId: string,
    name: string,
    permissions: any = { '*': true },
  ): Promise<{ name: string; key: string }> {
    // Generate 32 bytes of entropy
    const rawKey = crypto.randomBytes(32).toString('base64url');
    const keyPrefix = rawKey.substring(0, 8);
    const hashedKey = await bcrypt.hash(rawKey, 12);

    await this.prisma.apiKey.create({
      data: {
        userId,
        name,
        keyPrefix,
        hashedKey,
        permissions,
      },
    });

    return { name, key: rawKey };
  }

  /**
   * Validates a plaintext API key.
   * Returns the associated user and permissions if valid.
   */
  async validateApiKey(rawKey: string): Promise<any | null> {
    const keyPrefix = rawKey.substring(0, 8);

    const apiKeys = await this.prisma.apiKey.findMany({
      where: { keyPrefix },
      include: { user: true },
    });

    for (const apiKey of apiKeys) {
      const isValid = await bcrypt.compare(rawKey, apiKey.hashedKey);
      if (isValid) {
        // Check expiry
        if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
          continue;
        }

        // Update last used
        await this.prisma.apiKey.update({
          where: { id: apiKey.id },
          data: { lastUsedAt: new Date() },
        });

        return {
          user: apiKey.user,
          permissions: apiKey.permissions,
        };
      }
    }

    return null;
  }

  /**
   * Revokes an API key.
   */
  async revokeApiKey(id: string, userId: string): Promise<void> {
    await this.prisma.apiKey.delete({
      where: { id, userId },
    });
  }
}
