import fp from 'fastify-plugin'
import Redis from 'ioredis'

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis
  }
}

/**
 * Validate Redis connection is healthy
 */
export async function validateRedisConnection(redis: Redis): Promise<boolean> {
  try {
    await redis.ping()
    return true
  } catch {
    return false
  }
}

export const redisPlugin = fp(async (fastify, options: { redis: Redis }) => {
  // Validate connection before decorating
  const isHealthy = await validateRedisConnection(options.redis)
  
  if (!isHealthy) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Redis connection validation failed')
    }
    fastify.log.warn('Redis connection failed, continuing without Redis (development mode)')
  }
  
  fastify.decorate('redis', options.redis)
  
  // Add health check endpoint
  fastify.get('/health/redis', async () => {
    const healthy = await validateRedisConnection(options.redis)
    return { 
      status: healthy ? 'healthy' : 'unhealthy',
      service: 'redis'
    }
  })
  
  fastify.addHook('onClose', async () => {
    options.redis.disconnect()
  })
})
