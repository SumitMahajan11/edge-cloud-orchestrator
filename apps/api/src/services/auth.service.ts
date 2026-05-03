import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import type { PrismaClient } from '@prisma/client';
import type { UserPayload } from '../types/fastify';
import { env } from '../config/env';

export class AuthService {
  private prisma: PrismaClient;
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;
  private readonly refreshExpiresIn: string;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.jwtSecret = env.JWT_SECRET;
    this.jwtExpiresIn = env.JWT_EXPIRES_IN;
    this.refreshExpiresIn = env.REFRESH_TOKEN_EXPIRES_IN;
  }

  /**
   * Hashes a plaintext password with 12 salt rounds.
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  /**
   * Compares a plaintext password with its hashed version.
   */
  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generates a pair of signed JWT access token and a database-backed refresh token.
   */
  async generateTokens(
    user: Omit<UserPayload, 'permissions'>,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const permissions = this.getPermissionsForRole(user.role);
    const accessToken = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role, 
        tenantId: user.tenantId,
        permissions 
      },
      this.jwtSecret,
      { expiresIn: this.jwtExpiresIn as any },
    );

    const refreshToken = uuidv4();
    const hashedRefreshToken = this.hashToken(refreshToken);
    const expiresAt = this.calculateExpiry(this.refreshExpiresIn);

    // Create a new session for this refresh token
    await this.prisma.session.create({
      data: {
        userId: user.id,
        token: accessToken, // We store the current access token reference if needed for logout
        refreshToken: hashedRefreshToken,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken, // Return the plaintext token to the user
      expiresAt,
    };
  }

  /**
   * Rotates a refresh token: invalidates the old one and issues a new pair.
   */
  async rotateRefreshToken(
    oldRefreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const hashedOldToken = this.hashToken(oldRefreshToken);
    const session = await this.prisma.session.findUnique({
      where: { refreshToken: hashedOldToken },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      // If session is missing or expired, delete any remaining for safety or just throw
      if (session) {
        await this.prisma.session.delete({ where: { id: session.id } });
      }
      throw new Error('Invalid or expired refresh token');
    }

    // Generate new tokens
    const userPayload: UserPayload = {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role as any,
      tenantId: session.user.tenantId,
      permissions: this.getPermissionsForRole(session.user.role),
    };

    const newTokens = await this.generateTokens(userPayload);

    // Revoke OLD session - we use token rotation (delete old, create new)
    await this.prisma.session.delete({ where: { id: session.id } });

    return newTokens;
  }

  /**
   * Revokes a session based on refresh token.
   */
  async revokeSession(refreshToken: string): Promise<void> {
    const hashedToken = this.hashToken(refreshToken);
    await this.prisma.session.deleteMany({
      where: { refreshToken: hashedToken },
    });
  }

  /**
   * Hashes a token using SHA-256 for secure database storage.
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Helper to parse expiry strings like '7d', '15m' into a Date object.
   */
  private calculateExpiry(expiryStr: string): Date {
    const value = parseInt(expiryStr);
    const unit = expiryStr.slice(-1);
    const now = new Date();

    switch (unit) {
      case 'd':
        return new Date(now.getTime() + value * 24 * 60 * 60 * 1000);
      case 'h':
        return new Date(now.getTime() + value * 60 * 60 * 1000);
      case 'm':
        return new Date(now.getTime() + value * 60 * 1000);
      default:
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // Default 7 days
    }
  }

  /**
   * Returns permissions for a given role.
   */
  private getPermissionsForRole(role: string): string[] {
    const rolePermissions: Record<string, string[]> = {
      ADMIN: ['*'],
      OPERATOR: ['tasks:*', 'nodes:*', 'schedule:*', 'metrics:read'],
      VIEWER: ['tasks:read', 'nodes:read', 'metrics:read'],
      SERVICE: ['tasks:execute', 'nodes:heartbeat', 'metrics:write'],
    };
    return rolePermissions[role.toUpperCase()] || [];
  }
}
