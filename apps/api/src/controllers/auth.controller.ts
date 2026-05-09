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
  ) {
    const { email, password } = request.body;
    const ip = request.ip;

    // 1. Check rate limit and lockout
    const rateLimit = await this.rateLimitService.checkLimit(ip, email);
    if (!rateLimit.allowed) {
      return reply.status(429).send({
        error: rateLimit.isLocked
          ? 'Account locked due to multiple failed attempts. Please try again in 15 minutes.'
          : 'Too many login attempts. Please try again later.',
        retryAfter: Math.ceil((rateLimit.reset - Date.now()) / 1000),
      });
    }

    // 2. Find user
    const user = await (request.server as any).prisma.user.findUnique({
      where: { email },
    });

    // 3. Verify user and password
    if (!user || !user.isActive) {
      await this.rateLimitService.recordAttempt(ip);
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const isValid = await this.authService.comparePassword(
      password,
      user.passwordHash,
    );
    if (!isValid) {
      await this.rateLimitService.recordAttempt(ip);
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // 4. Reset attempts on success
    await this.rateLimitService.reset(ip, email);

    // 5. Generate tokens
    const tokens = await this.authService.generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: (user as any).tenantId,
    }, request.ip, request.headers['user-agent'] || 'unknown');

    // 6. Set refresh token in httpOnly cookie
    reply.setCookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: tokens.expiresAt,
      path: '/api/auth',
    });

    return {
      token: tokens.accessToken,
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
  ) {
    const { email, password, name } = request.body;
    const prisma = (request.server as any).prisma;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const passwordHash = await this.authService.hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role: 'VIEWER',
      },
    });

    return reply.status(201).send({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  }

  async refresh(
    request: FastifyRequest<{ Body: InferSchema<typeof refreshTokenSchema> }>,
    reply: FastifyReply,
  ) {
    const refreshToken =
      request.body.refreshToken || request.cookies.refreshToken;

    if (!refreshToken) {
      return reply.status(401).send({ error: 'Refresh token required' });
    }

    try {
      const tokens = await this.authService.rotateRefreshToken(
        refreshToken,
        request.ip,
        request.headers['user-agent'] || 'unknown'
      );

      reply.setCookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        expires: tokens.expiresAt,
        path: '/api/auth',
      });

      return {
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      };
    } catch (error: any) {
      // If security alert or reuse detected, we might want to be more specific or generic
      const message = error.message.includes('reuse detected') 
        ? 'Security alert: Refresh token reuse detected. All sessions invalidated.'
        : 'Invalid or expired refresh token';
        
      return reply
        .status(401)
        .send({ error: message });
    }
  }

  async logout(request: FastifyRequest, reply: FastifyReply) {
    const refreshToken = request.cookies.refreshToken;
    if (refreshToken) {
      await this.authService.revokeSession(refreshToken);
    }
    reply.clearCookie('refreshToken', { path: '/api/auth' });
    return { success: true };
  }

  async me(request: FastifyRequest, _reply: FastifyReply) {
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

  async listSessions(request: FastifyRequest, _reply: FastifyReply) {
    const userId = request.user!.id;
    const sessions = await this.authService.listUserSessions(userId);
    return sessions;
  }

  async revokeSession(request: FastifyRequest<{ Params: { id: string } }>, _reply: FastifyReply) {
    const userId = request.user!.id;
    const sessionId = request.params.id;
    await this.authService.revokeSessionById(sessionId, userId);
    return { success: true };
  }

  async revokeAllSessions(request: FastifyRequest, _reply: FastifyReply) {
    const userId = request.user!.id;
    await this.authService.revokeAllUserSessions(userId);
    return { success: true };
  }
}
