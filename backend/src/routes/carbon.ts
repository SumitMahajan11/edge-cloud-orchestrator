import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { carbonQuerySchema } from '../schemas'
import { zodToFastifySchema } from '../utils/zod-schema'

export default async function carbonRoutes(fastify: FastifyInstance) {
  // Get carbon summary
  fastify.get('/summary', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['carbon'],
      summary: 'Get carbon footprint summary',
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    
    const [total, thisMonth, avgRenewable] = await Promise.all([
      fastify.prisma.carbonMetric.aggregate({
        _sum: { carbonKg: true, energyKwh: true },
      }),
      fastify.prisma.carbonMetric.aggregate({
        where: { recordedAt: { gte: startOfMonth } },
        _sum: { carbonKg: true, energyKwh: true },
      }),
      fastify.prisma.carbonMetric.aggregate({
        _avg: { renewablePercent: true },
      }),
    ])
    
    return {
      total: {
        carbonKg: total._sum.carbonKg || 0,
        energyKwh: total._sum.energyKwh || 0,
      },
      thisMonth: {
        carbonKg: thisMonth._sum.carbonKg || 0,
        energyKwh: thisMonth._sum.energyKwh || 0,
      },
      avgRenewablePercent: avgRenewable._avg.renewablePercent || 0,
    }
  })
  
  // Get carbon metrics
  fastify.get('/metrics', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: zodToFastifySchema(carbonQuerySchema),
      tags: ['carbon'],
      summary: 'Get carbon metrics',
    },
  }, async (request: FastifyRequest<{ Querystring: z.infer<typeof carbonQuerySchema> }>, reply: FastifyReply) => {
    const { region, from, to } = request.query
    
    const metrics = await fastify.prisma.carbonMetric.findMany({
      where: {
        ...(region && { region }),
        ...(from && { recordedAt: { gte: new Date(from) } }),
        ...(to && { recordedAt: { lte: new Date(to) } }),
      },
      orderBy: { recordedAt: 'desc' },
      take: 1000,
    })
    
    return metrics
  })
  
  // Get carbon by region
  fastify.get('/by-region', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['carbon'],
      summary: 'Get carbon breakdown by region',
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const byRegion = await fastify.prisma.carbonMetric.groupBy({
      by: ['region'],
      _sum: { carbonKg: true, energyKwh: true },
      _avg: { renewablePercent: true },
    })
    
    return byRegion.map(r => ({
      region: r.region,
      carbonKg: r._sum.carbonKg || 0,
      energyKwh: r._sum.energyKwh || 0,
      avgRenewablePercent: r._avg.renewablePercent || 0,
    }))
  })
  
  // Record carbon metric (called by edge agents or scheduled job)
  fastify.post('/record', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          nodeId: { type: 'string' },
          region: { type: 'string' },
          energyKwh: { type: 'number' },
          carbonKg: { type: 'number' },
          renewablePercent: { type: 'number' },
        },
        required: ['region', 'energyKwh', 'carbonKg'],
      },
      tags: ['carbon'],
      summary: 'Record carbon metric',
    },
  }, async (request: FastifyRequest<{ Body: { nodeId?: string; region: string; energyKwh: number; carbonKg: number; renewablePercent?: number } }>, reply: FastifyReply) => {
    const { nodeId, region, energyKwh, carbonKg, renewablePercent } = request.body
    const metric = await fastify.prisma.carbonMetric.create({
      data: { nodeId, region, energyKwh, carbonKg, renewablePercent },
    })
    
    return reply.status(201).send(metric)
  })
}
