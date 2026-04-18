import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import type { PrismaClient } from '@prisma/client';
import type { UserPayload } from '../types/fastify';

export class AuthService {
  private prisma: PrismaClient;
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;
  private readonly refreshExpiresIn: string;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.jwtSecret = process.env.JWT_SECRET!;
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '15m';
    this.refreshExpiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';

    if (!this.jwtSecret || this.jwtSecret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters');
    }
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
    user: UserPayload,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const accessToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      this.jwtSecret,
      { expiresIn: this.jwtExpiresIn as any },
    );

    const refreshToken = uuidv4();
    const expiresAt = this.calculateExpiry(this.refreshExpiresIn);

    // Create a new session for this refresh token
    await this.prisma.session.create({
      data: {
        userId: user.id,
        token: accessToken, // We store the current access token reference if needed for logout
        refreshToken,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresAt,
    };
  }

  /**
   * Rotates a refresh token: invalidates the old one and issues a new pair.
   */
  async rotateRefreshToken(
    oldRefreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const session = await this.prisma.session.findUnique({
      where: { refreshToken: oldRefreshToken },
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
    await this.prisma.session.deleteMany({
      where: { refreshToken },
    });
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
}
