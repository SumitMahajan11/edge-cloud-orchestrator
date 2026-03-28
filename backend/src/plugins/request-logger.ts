import fp from 'fastify-plugin'
import { FastifyInstance, FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify'

export const requestLogger = fp(async (fastify: FastifyInstance) => {
  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    request.log.info({
      msg: 'Incoming request',
      method: request.method,
      url: request.url,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    })
  })
  
  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const responseTime = reply.elapsedTime
    
    request.log.info({
      msg: 'Request completed',
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: `${responseTime.toFixed(2)}ms`,
    })
    
    // Store request metrics in Redis for monitoring
    if (process.env.METRICS_ENABLED === 'true') {
      const date = new Date().toISOString().split('T')[0]
      const key = `metrics:requests:${date}`
      
      await fastify.redis
        .multi()
        .hincrby(key, 'total', 1)
        .hincrby(key, `status:${Math.floor(reply.statusCode / 100)}xx`, 1)
        .hincrbyfloat(key, 'responseTime', responseTime)
        .expire(key, 86400 * 7) // Keep for 7 days
        .exec()
        .catch(() => {}) // Ignore errors
    }
  })
})
