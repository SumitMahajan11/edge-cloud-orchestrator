import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import jwt from 'jsonwebtoken'
import { registerSchema, loginSchema, refreshTokenSchema, createApiKeySchema } from '../schemas'
import { zodToFastifySchema } from '../utils/zod-schema'

const JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret'
const JWT_EXPIRES_IN = '15m'
const REFRESH_EXPIRES_IN = '7d'

// Helper function to get permissions for a role
function getPermissionsForRole(role: string): string[] {
  const rolePermissions: Record<string, string[]> = {
    ADMIN: ['*'],
    OPERATOR: ['tasks:*', 'nodes:*', 'schedule:*', 'metrics:read'],
    VIEWER: ['tasks:read', 'nodes:read', 'metrics:read'],
  }
  return rolePermissions[role] || rolePermissions.VIEWER
}

// Role enum values
const Role = {
  ADMIN: 'ADMIN',
  OPERATOR: 'OPERATOR',
  VIEWER: 'VIEWER',
} as const

type RegisterBody = { email: string; password: string; name: string }
type LoginBody = { email: string; password: string }
type RefreshBody = { refreshToken: string }
type ApiKeyBody = { name: string; permissions?: string[]; expiresAt?: string | null }



export default async function authRoutes(fastify: FastifyInstance) {
  // Register new user
  fastify.post('/register', {
    schema: {
      body: zodToFastifySchema(registerSchema),
      tags: ['auth'],
      summary: 'Register a new user',
    },
  }, async (request: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply) => {
    const { email, password, name } = request.body
    
    // Check if user exists
    const existing = await fastify.prisma.user.findUnique({ where: { email } })
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' })
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 12)
    
    // Create user
    const user = await fastify.prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role: Role.VIEWER,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    })
    
    // Audit log
    await fastify.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'user.registered',
        entityType: 'user',
        entityId: user.id,
        details: { email, name },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      },
    })
    
    return reply.status(201).send(user)
  })
  
  // Login
  fastify.post('/login', {
    schema: {
      body: zodToFastifySchema(loginSchema),
      tags: ['auth'],
      summary: 'Login and get tokens',
    },
  }, async (request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
    const { email, password } = request.body
    
    // Find user
    const user = await fastify.prisma.user.findUnique({ where: { email } })
    if (!user || !user.isActive) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }
    
    // Verify password
    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }
    
    // Generate JWT tokens
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role,
        permissions: getPermissionsForRole(user.role)
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    )
    const refreshToken = uuidv4()
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    
    // Create session with refresh token
    await fastify.prisma.session.create({
      data: {
        userId: user.id,
        token: refreshToken, // Store refresh token in DB
        refreshToken,
        expiresAt: refreshExpiresAt,
      },
    })
    
    // Update last login
    await fastify.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })
    
    // Audit log
    await fastify.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'user.login',
        entityType: 'session',
        details: { method: 'password' },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      },
    })
    
    // Set cookie
    reply.setCookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: refreshExpiresAt,
      path: '/api/auth',
    })
    
    return {
      token,
      refreshToken,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    }
  })
  
  // Refresh token
  fastify.post('/refresh', {
    schema: {
      body: zodToFastifySchema(refreshTokenSchema),
      tags: ['auth'],
      summary: 'Refresh access token',
    },
  }, async (request: FastifyRequest<{ Body: RefreshBody }>, reply: FastifyReply) => {
    const { refreshToken } = request.body
    
    // Find session
    const session = await fastify.prisma.session.findUnique({
      where: { refreshToken },
      include: { user: true },
    })
    
    if (!session || session.expiresAt < new Date()) {
      return reply.status(401).send({ error: 'Invalid or expired refresh token' })
    }
    
    // Generate new tokens
    const newToken = uuidv4()
    const newRefreshToken = uuidv4()
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    
    // Update session
    await fastify.prisma.session.update({
      where: { id: session.id },
      data: {
        token: newToken,
        refreshToken: newRefreshToken,
        expiresAt: refreshExpiresAt,
      },
    })
    
    return {
      token: newToken,
      refreshToken: newRefreshToken,
      expiresAt: expiresAt.toISOString(),
    }
  })
  
  // Logout
  fastify.post('/logout', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.headers.authorization?.replace('Bearer ', '')
    
    if (token) {
      await fastify.prisma.session.deleteMany({ where: { token } })
    }
    
    reply.clearCookie('refreshToken', { path: '/api/auth' })
    
    return { success: true }
  })
  
  // Get current user
  fastify.get('/me', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const user = await fastify.prisma.user.findUnique({
      where: { id: request.user!.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        lastLoginAt: true,
      },
    })
    
    return user
  })
  
  // Create API key
  fastify.post('/api-keys', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: ApiKeyBody }>, _reply: FastifyReply) => {
    const { name, permissions, expiresAt } = request.body
    
    const key = `sk_${uuidv4().replace(/-/g, '')}`
    
    const apiKey = await fastify.prisma.apiKey.create({
      data: {
        userId: request.user!.id,
        name,
        key,
        permissions: permissions || [],
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    })
    
    // Audit log
    await fastify.prisma.auditLog.create({
      data: {
        userId: request.user!.id,
        action: 'api_key.created',
        entityType: 'api_key',
        entityId: apiKey.id,
        details: { name },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      },
    })
    
    return {
      id: apiKey.id,
      name: apiKey.name,
      key, // Only returned once!
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    }
  })
  
  // List API keys
  fastify.get('/api-keys', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const keys = await fastify.prisma.apiKey.findMany({
      where: { userId: request.user!.id },
      select: {
        id: true,
        name: true,
        permissions: true,
        expiresAt: true,
        createdAt: true,
        lastUsedAt: true,
      },
    })
    
    return keys
  })
  
  // Delete API key
  fastify.delete('/api-keys/:id', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    
    const key = await fastify.prisma.apiKey.findFirst({
      where: { id, userId: request.user!.id },
    })
    
    if (!key) {
      return reply.status(404).send({ error: 'API key not found' })
    }
    
    await fastify.prisma.apiKey.delete({ where: { id } })
    
    return { success: true }
  })
}
