import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from '../services/auth.service';
import { RateLimitService } from '../services/rate-limit.service';
import { InferSchema } from '../types/fastify';
import { loginSchema, registerSchema, refreshTokenSchema } from '../schemas';
import { env } from '../config/env';

export class AuthController {
  private authService: AuthService;
  private rateLimitService: RateLimitService;

  constructor(authService: AuthService, rateLimitService: RateLimitService) {
    this.authService = authService;
    this.rateLimitService = rateLimitService;
  }

  async login(
    request: FastifyRequest<{ Body: InferSchema<typeof loginSchema> }>,
    reply: FastifyReply,
  ): Promise<any> {
    const { email, password } = request.body;
    const ip = request.ip;

    // 1. Check rate limit and lockout
    const rateLimit = await this.rateLimitService.checkLimit(ip, email);
    if (!rateLimit.allowed) {
      const err = new Error(
        rateLimit.isLocked
          ? 'Account locked due to multiple failed attempts. Please try again in 15 minutes.'
          : 'Too many login attempts. Please try again later.',
      ) as any;
      err.statusCode = 429;
      err.code = 'RATE_LIMIT_EXCEEDED';
      throw err;
    }

    // 2. Find user (with retry loop for serverless DB cold starts)
    const prisma = (request.server as any).prisma;
    let user: any;
    let lastError: any = null;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        user = await Promise.race([
          prisma.user.findUnique({
            where: { email },
            include: { tenantUsers: { take: 1 } },
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Database timeout')), 15000),
          ),
        ]);
        lastError = null;
        break; // Query succeeded, exit retry loop
      } catch (dbErr: any) {
        lastError = dbErr;
        request.log.warn(
          { attempt, maxRetries, err: dbErr?.message || dbErr },
          'Database query failed during auth login, retrying for cold start...',
        );
        if (attempt < maxRetries) {
          // Wait 2s before next attempt to allow serverless DB compute to resume
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    if (lastError) {
      request.log.error(
        { err: lastError?.message || lastError },
        'Database error during auth login after retries',
      );
      const err = new Error(
        'Database unavailable or warming up. Please retry shortly.',
      ) as any;
      err.statusCode = 503;
      err.code = 'SERVICE_UNAVAILABLE';
      throw err;
    }

    // 3. Verify user and password
    if (!user || !user.isActive) {
      await this.rateLimitService.recordAttempt(ip);
      const err = new Error('Invalid credentials') as any;
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    const isValid = await this.authService.comparePassword(
      password,
      user.passwordHash,
    );
    if (!isValid) {
      await this.rateLimitService.recordAttempt(ip);
      const err = new Error('Invalid credentials') as any;
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    // 4. Reset attempts on success
    await this.rateLimitService.reset(ip, email);

    // 5. Generate tokens
    const tokens = await this.authService.generateTokens(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantUsers?.[0]?.tenantId,
      },
      request.ip,
      request.headers['user-agent'] || 'unknown',
    );

    // 6. Set refresh token in httpOnly cookie
    void reply.setCookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
      expires: tokens.expiresAt,
      path: '/',
    });

    return {
      token: tokens.accessToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async register(
    request: FastifyRequest<{ Body: InferSchema<typeof registerSchema> }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    const { email, password, name } = request.body;
    const prisma = (request.server as any).prisma;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      const err = new Error('Email already registered') as any;
      err.statusCode = 409;
      err.code = 'RESOURCE_CONFLICT';
      throw err;
    }

    // Find or create default tenant 'demo-org'
    let tenant = await prisma.tenant.findUnique({
      where: { slug: 'demo-org' },
    });
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          name: 'Demo Organization',
          slug: 'demo-org',
          config: {},
        },
      });
    }

    const passwordHash = await this.authService.hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role: 'VIEWER',
        tenantUsers: {
          create: {
            tenantId: tenant.id,
            role: 'VIEWER',
          },
        },
      },
      include: { tenantUsers: { take: 1 } },
    });

    // Generate tokens
    const tokens = await this.authService.generateTokens(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantUsers?.[0]?.tenantId,
      },
      request.ip,
      request.headers['user-agent'] || 'unknown',
    );

    // Set refresh token in httpOnly cookie
    void reply.setCookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
      expires: tokens.expiresAt,
      path: '/',
    });

    return reply.status(201).send({
      token: tokens.accessToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  }

  async refresh(
    request: FastifyRequest<{ Body: InferSchema<typeof refreshTokenSchema> }>,
    reply: FastifyReply,
  ): Promise<any> {
    const refreshToken =
      request.body.refreshToken || request.cookies.refreshToken;

    if (!refreshToken) {
      const err = new Error('Refresh token required') as any;
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    try {
      const tokens = await this.authService.rotateRefreshToken(
        refreshToken,
        request.ip,
        request.headers['user-agent'] || 'unknown',
      );

      void reply.setCookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
        expires: tokens.expiresAt,
        path: '/',
      });

      return {
        token: tokens.accessToken,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      };
    } catch (error: any) {
      // If security alert or reuse detected, we might want to be more specific or generic
      const message = error.message.includes('reuse detected')
        ? 'Security alert: Refresh token reuse detected. All sessions invalidated.'
        : 'Invalid or expired refresh token';

      const err = new Error(message) as any;
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }
  }

  async logout(request: FastifyRequest, reply: FastifyReply): Promise<any> {
    const refreshToken = request.cookies.refreshToken;
    if (refreshToken) {
      await this.authService.revokeSession(refreshToken);
    }
    void reply.clearCookie('refreshToken', { path: '/' });
    return { success: true };
  }

  async me(request: FastifyRequest, _reply: FastifyReply): Promise<any> {
    const user = await (request.server as any).prisma.user.findUnique({
      where: { id: request.user!.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
    return user;
  }

  async listSessions(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<any> {
    const userId = request.user!.id;
    const sessions = await this.authService.listUserSessions(userId);
    return sessions;
  }

  async revokeSession(
    request: FastifyRequest<{ Params: { id: string } }>,
    _reply: FastifyReply,
  ): Promise<any> {
    const userId = request.user!.id;
    const sessionId = request.params.id;
    await this.authService.revokeSessionById(sessionId, userId);
    return { success: true };
  }

  async revokeAllSessions(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<any> {
    const userId = request.user!.id;
    await this.authService.revokeAllUserSessions(userId);
    return { success: true };
  }
}
