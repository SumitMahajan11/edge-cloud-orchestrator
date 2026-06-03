// No explicit imports needed when globals: true is set in vitest config
import { AuthService } from '../services/auth.service';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

// Mock Prisma
const mockPrisma = {
  userSession: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    findMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
} as unknown as PrismaClient;

// Mock Redis
const mockRedis = {
  set: vi.fn().mockResolvedValue('OK'),
  get: vi.fn().mockResolvedValue(null),
  pipeline: vi.fn(),
} as unknown as Redis;

describe('Auth Hardening E2E Logic', () => {
  let authService: AuthService;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    role: 'ADMIN' as const,
    tenantId: 'tenant-456',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authService = new AuthService(mockPrisma, mockRedis);
  });

  describe('Refresh Token Rotation', () => {
    it('should issue new tokens and revoke the old session', async () => {
      const oldRefreshToken = 'old-token';
      const hashedOldToken = (authService as any).hashToken(oldRefreshToken);
      
      const mockSession = {
        id: 'session-1',
        userId: mockUser.id,
        refreshTokenHash: hashedOldToken,
        accessTokenJti: 'jti-old',
        revoked: false,
        expiresAt: new Date(Date.now() + 10000),
        user: mockUser,
      };

      vi.spyOn(mockPrisma.userSession, 'findUnique').mockResolvedValue(mockSession as any);
      vi.spyOn(mockPrisma.userSession, 'create').mockResolvedValue({} as any);
      vi.spyOn(mockPrisma.userSession, 'update').mockResolvedValue({} as any);

      const result = await authService.rotateRefreshToken(oldRefreshToken, '127.0.0.1', 'test-agent');

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.refreshToken).not.toBe(oldRefreshToken);
      
      // Verify old session revoked
      expect(mockPrisma.userSession.update).toHaveBeenCalledWith({
        where: { id: mockSession.id },
        data: expect.objectContaining({ revoked: true }),
      });

      // Verify old access token revoked in Redis
      expect(mockRedis.set).toHaveBeenCalledWith(
        `revoked_token:${mockSession.accessTokenJti}`,
        'revoked',
        'EX',
        3600
      );
    });

    it('should detect reuse and invalidate ALL sessions', async () => {
      const reusedToken = 'reused-token';
      const hashedReusedToken = (authService as any).hashToken(reusedToken);
      
      const mockSession = {
        id: 'session-1',
        userId: mockUser.id,
        refreshTokenHash: hashedReusedToken,
        revoked: true, // Already used!
        user: mockUser,
      };

      vi.spyOn(mockPrisma.userSession, 'findUnique').mockResolvedValue(mockSession as any);
      
      try {
        await authService.rotateRefreshToken(reusedToken, '127.0.0.1', 'attacker-agent');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toMatch(/Refresh token reuse detected/);
      }

      // Verify all sessions invalidated
      expect(mockPrisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
        data: { revoked: true },
      });

      // Verify SECURITY_ALERT logged
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'SECURITY_ALERT',
          details: expect.objectContaining({
            alertType: 'TOKEN_THEFT_ATTEMPT'
          }),
        }),
      });
    });
  });

  describe('Session Management', () => {
    it('should list only active sessions', async () => {
      vi.spyOn(mockPrisma.userSession, 'findMany').mockResolvedValue([]);
      
      await authService.listUserSessions(mockUser.id);
      
      expect(mockPrisma.userSession.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          userId: mockUser.id,
          revoked: false,
          expiresAt: { gte: expect.any(Date) }
        }),
        select: expect.any(Object),
        orderBy: { lastUsedAt: 'desc' },
      });
    });

    it('should revoke specific session and its access token', async () => {
      const sessionId = 'session-to-revoke';
      const mockSession = { id: sessionId, accessTokenJti: 'jti-123' };
      
      vi.spyOn(mockPrisma.userSession, 'findFirst').mockResolvedValue(mockSession as any);
      
      await authService.revokeSessionById(sessionId, mockUser.id);
      
      expect(mockPrisma.userSession.update).toHaveBeenCalledWith({
        where: { id: sessionId },
        data: { revoked: true },
      });

      expect(mockRedis.set).toHaveBeenCalledWith(
        `revoked_token:${mockSession.accessTokenJti}`,
        'revoked',
        'EX',
        3600
      );
    });

    it('should revoke all user sessions and their access tokens', async () => {
      const sessions = [
        { accessTokenJti: 'jti-1' },
        { accessTokenJti: 'jti-2' }
      ];
      
      vi.spyOn(mockPrisma.userSession, 'findMany').mockResolvedValue(sessions as any);
      const mockPipeline = {
        set: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      };
      vi.spyOn(mockRedis, 'pipeline').mockReturnValue(mockPipeline as any);
      
      await authService.revokeAllUserSessions(mockUser.id);
      
      expect(mockPrisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
        data: { revoked: true },
      });

      expect(mockPipeline.set).toHaveBeenCalledTimes(2);
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });
});
