import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import type { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import type { UserPayload } from '../types/fastify';
import { env } from '../config/env';

export class AuthService {
  private prisma: PrismaClient;
  private redis: Redis | undefined;
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;
  private readonly refreshExpiresIn: string;

  private readonly jwtIssuer: string;
  private readonly jwtAudience: string;

  constructor(prisma: PrismaClient, redis?: Redis) {
    this.prisma = prisma;
    this.redis = redis;
    this.jwtSecret = env.JWT_SECRET;
    this.jwtExpiresIn = env.JWT_EXPIRES_IN;
    this.refreshExpiresIn = env.REFRESH_TOKEN_EXPIRES_IN;
    this.jwtIssuer = env.JWT_ISSUER;
    this.jwtAudience = env.JWT_AUDIENCE;
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
    ipAddress: string,
    userAgent: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const permissions = this.getPermissionsForRole(user.role);
    const jti = uuidv4();

    const accessToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        permissions,
        jti,
      },
      this.jwtSecret,
      {
        expiresIn: this.jwtExpiresIn as any,
        issuer: this.jwtIssuer,
        audience: this.jwtAudience,
      },
    );

    const refreshToken = uuidv4();
    const hashedRefreshToken = this.hashToken(refreshToken);
    const expiresAt = this.calculateExpiry(this.refreshExpiresIn);

    // Create a new session for this refresh token
    await this.prisma.userSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: hashedRefreshToken,
        accessTokenJti: jti,
        ipAddress,
        userAgent,
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
   * Includes REUSE DETECTION: if a revoked token is used, all sessions for the user are invalidated.
   */
  async rotateRefreshToken(
    oldRefreshToken: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const hashedOldToken = this.hashToken(oldRefreshToken);
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: hashedOldToken },
      include: { user: { include: { tenantUsers: { take: 1 } } } },
    });

    if (!session) {
      throw new Error('Invalid refresh token');
    }

    const tenantId = (session.user as any).tenantUsers?.[0]?.tenantId;

    // REUSE DETECTION: If token is already revoked, it indicates potential theft
    if (session.revoked) {
      // Security measure: Invalidate all sessions for this user
      await this.prisma.userSession.updateMany({
        where: { userId: session.userId },
        data: { revoked: true },
      });

      // Log SECURITY_ALERT audit event
      await this.prisma.auditLog.create({
        data: {
          userId: session.userId,
          tenantId: tenantId || 'system',
          action: 'SECURITY_ALERT',
          entityType: 'auth',
          details: {
            reason: 'refresh_token_reuse_detected',
            sessionId: session.id,
            ipAddress,
            userAgent,
            alertType: 'TOKEN_THEFT_ATTEMPT',
          } as any,
          ipAddress,
          userAgent,
        },
      });

      throw new Error(
        'Refresh token reuse detected. All sessions invalidated for security.',
      );
    }

    if (session.expiresAt < new Date()) {
      await this.prisma.userSession.delete({ where: { id: session.id } });
      throw new Error('Refresh token expired');
    }

    // Generate new tokens
    const userPayload: UserPayload = {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role as any,
      tenantId: tenantId,
      permissions: this.getPermissionsForRole(session.user.role),
    };

    const newTokens = await this.generateTokens(
      userPayload,
      ipAddress,
      userAgent,
    );

    // Invalidate OLD session immediately (Rotation)
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { revoked: true, lastUsedAt: new Date() },
    });

    // Revoke old access token in Redis
    if (this.redis) {
      await this.redis.set(
        `revoked_token:${session.accessTokenJti}`,
        'revoked',
        'EX',
        3600, // 1 hour TTL is enough for 15min access tokens
      );
    }

    return newTokens;
  }

  /**
   * Revokes a session based on refresh token.
   */
  async revokeSession(refreshToken: string): Promise<void> {
    const hashedToken = this.hashToken(refreshToken);
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: hashedToken },
    });

    if (session) {
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { revoked: true },
      });

      if (this.redis) {
        await this.redis.set(
          `revoked_token:${session.accessTokenJti}`,
          'revoked',
          'EX',
          3600,
        );
      }
    }
  }

  /**
   * Revokes all sessions for a user.
   */
  async revokeAllUserSessions(userId: string): Promise<void> {
    const activeSessions = await this.prisma.userSession.findMany({
      where: { userId, revoked: false },
      select: { accessTokenJti: true },
    });

    await this.prisma.userSession.updateMany({
      where: { userId },
      data: { revoked: true },
    });

    if (this.redis && activeSessions.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const session of activeSessions) {
        pipeline.set(
          `revoked_token:${session.accessTokenJti}`,
          'revoked',
          'EX',
          3600,
        );
      }
      await pipeline.exec();
    }
  }

  /**
   * Revokes a specific session by ID.
   */
  async revokeSessionById(sessionId: string, userId: string): Promise<void> {
    const session = await this.prisma.userSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (session) {
      await this.prisma.userSession.update({
        where: { id: sessionId },
        data: { revoked: true },
      });

      if (this.redis) {
        await this.redis.set(
          `revoked_token:${session.accessTokenJti}`,
          'revoked',
          'EX',
          3600,
        );
      }
    }
  }

  /**
   * Lists active sessions for a user.
   */
  async listUserSessions(userId: string): Promise<any[]> {
    return this.prisma.userSession.findMany({
      where: {
        userId,
        revoked: false,
        expiresAt: { gte: new Date() },
      },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
      orderBy: { lastUsedAt: 'desc' },
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
