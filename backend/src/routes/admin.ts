import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

type UserRoleStr = 'ADMIN' | 'OPERATOR' | 'VIEWER'

export default async function adminRoutes(fastify: FastifyInstance) {
  // Get audit logs
  fastify.get('/audit-logs', {
    preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
    schema: {
      tags: ['admin'],
      summary: 'Get audit logs',
    },
  }, async (request: FastifyRequest<{ Querystring: { userId?: string; action?: string; limit?: number } }>, reply: FastifyReply) => {
    const { userId, action, limit = 100 } = request.query
    
    const logs = await fastify.prisma.auditLog.findMany({
      where: {
        ...(userId && { userId }),
        ...(action && { action }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
      },
    })
    
    return logs
  })
  
  // List users
  fastify.get('/users', {
    preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
    schema: {
      tags: ['admin'],
      summary: 'List all users',
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const users = await fastify.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        emailVerified: true,
        createdAt: true,
        lastLoginAt: true,
        _count: { select: { sessions: true, apiKeys: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    
    return users
  })
  
  // Update user role
  fastify.patch('/users/:id/role', {
    preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
    schema: {
      tags: ['admin'],
      summary: 'Update user role',
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: { role: UserRoleStr } }>, reply: FastifyReply) => {
    const { id } = request.params
    const { role } = request.body
    
    const currentUser = request.user as { id: string }
    if (id === currentUser.id) {
      return reply.status(400).send({ error: 'Cannot change your own role' })
    }
    
    const user = await fastify.prisma.user.update({
      where: { id },
      data: { role },
    })
    
    // Audit log
    await fastify.prisma.auditLog.create({
      data: {
        userId: currentUser.id,
        action: 'user.role_changed',
        entityType: 'user',
        entityId: id,
        details: { newRole: role },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      },
    })
    
    return user
  })
  
  // Deactivate user
  fastify.post('/users/:id/deactivate', {
    preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
    schema: {
      tags: ['admin'],
      summary: 'Deactivate user',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    
    const currentUser = request.user as { id: string }
    if (id === currentUser.id) {
      return reply.status(400).send({ error: 'Cannot deactivate yourself' })
    }
    
    const user = await fastify.prisma.user.update({
      where: { id },
      data: { isActive: false },
    })
    
    // Invalidate all sessions
    await fastify.prisma.session.deleteMany({ where: { userId: id } })
    
    return user
  })
  
  // Get system health
  fastify.get('/health', {
    preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
    schema: {
      tags: ['admin'],
      summary: 'Get system health',
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const [dbHealth, redisHealth] = await Promise.all([
      fastify.prisma.$queryRaw`SELECT 1`.then(() => 'healthy').catch(() => 'unhealthy'),
      fastify.redis.ping().then(() => 'healthy').catch(() => 'unhealthy'),
    ])
    
    return {
      database: dbHealth,
      redis: redisHealth,
      timestamp: new Date().toISOString(),
    }
  })
  
  // Clear old data
  fastify.post('/cleanup', {
    preHandler: [fastify.authenticate, fastify.requireRole('ADMIN')],
    schema: {
      tags: ['admin'],
      summary: 'Clean up old data',
    },
  }, async (request: FastifyRequest<{ Body: { olderThanDays: number; types: string[] } }>, reply: FastifyReply) => {
    const { olderThanDays, types } = request.body
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
    
    const results: Record<string, number> = {}
    
    if (types.includes('metrics')) {
      results.nodeMetrics = await fastify.prisma.nodeMetric.deleteMany({
        where: { timestamp: { lt: cutoff } },
      }).then(r => r.count)
    }
    
    if (types.includes('logs')) {
      results.taskLogs = await fastify.prisma.taskLog.deleteMany({
        where: { timestamp: { lt: cutoff } },
      }).then(r => r.count)
    }
    
    if (types.includes('webhookDeliveries')) {
      results.webhookDeliveries = await fastify.prisma.webhookDelivery.deleteMany({
        where: { createdAt: { lt: cutoff } },
      }).then(r => r.count)
    }
    
    if (types.includes('auditLogs')) {
      results.auditLogs = await fastify.prisma.auditLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      }).then(r => r.count)
    }
    
    return { deleted: results, cutoff: cutoff.toISOString() }
  })
}
