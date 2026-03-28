import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

export default async function metricsRoutes(fastify: FastifyInstance) {
  // System metrics
  fastify.get('/', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['metrics'],
      summary: 'Get system metrics',
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const [
      totalNodes,
      onlineNodes,
      totalTasks,
      pendingTasks,
      runningTasks,
      completedTasks,
      failedTasks,
    ] = await Promise.all([
      fastify.prisma.edgeNode.count(),
      fastify.prisma.edgeNode.count({ where: { status: 'ONLINE' } }),
      fastify.prisma.task.count(),
      fastify.prisma.task.count({ where: { status: 'PENDING' } }),
      fastify.prisma.task.count({ where: { status: 'RUNNING' } }),
      fastify.prisma.task.count({ where: { status: 'COMPLETED' } }),
      fastify.prisma.task.count({ where: { status: 'FAILED' } }),
    ])
    
    // Get average latency from online nodes
    const avgLatency = await fastify.prisma.edgeNode.aggregate({
      where: { status: 'ONLINE' },
      _avg: { latency: true },
    })
    
    // Get total cost
    const totalCost = await fastify.prisma.costRecord.aggregate({
      _sum: { cost: true },
    })
    
    // Get carbon metrics
    const carbon = await fastify.prisma.carbonMetric.aggregate({
      _sum: { carbonKg: true, energyKwh: true },
    })
    
    return {
      nodes: {
        total: totalNodes,
        online: onlineNodes,
        offline: totalNodes - onlineNodes,
      },
      tasks: {
        total: totalTasks,
        pending: pendingTasks,
        running: runningTasks,
        completed: completedTasks,
        failed: failedTasks,
        successRate: totalTasks > 0 ? (completedTasks / totalTasks * 100).toFixed(2) : 0,
      },
      performance: {
        avgLatency: avgLatency._avg.latency || 0,
      },
      cost: {
        total: totalCost._sum.cost || 0,
      },
      sustainability: {
        totalCarbonKg: carbon._sum.carbonKg || 0,
        totalEnergyKwh: carbon._sum.energyKwh || 0,
      },
      timestamp: new Date().toISOString(),
    }
  })
  
  // Request metrics from Redis
  fastify.get('/requests', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['metrics'],
      summary: 'Get request metrics',
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const today = new Date().toISOString().split('T')[0]
    const key = `metrics:requests:${today}`
    
    const metrics = await fastify.redis.hgetall(key)
    
    return {
      date: today,
      total: parseInt(metrics.total || '0'),
      responseTime: parseFloat(metrics.responseTime || '0'),
      status2xx: parseInt(metrics['status:2xx'] || '0'),
      status4xx: parseInt(metrics['status:4xx'] || '0'),
      status5xx: parseInt(metrics['status:5xx'] || '0'),
    }
  })
  
  // Node metrics summary
  fastify.get('/nodes', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['metrics'],
      summary: 'Get node metrics summary',
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const nodes = await fastify.prisma.edgeNode.findMany({
      where: { status: 'ONLINE' },
      select: {
        id: true,
        name: true,
        region: true,
        cpuUsage: true,
        memoryUsage: true,
        latency: true,
        tasksRunning: true,
      },
    })
    
    const byRegion = nodes.reduce((acc, node) => {
      if (!acc[node.region]) {
        acc[node.region] = { count: 0, avgCpu: 0, avgMemory: 0, avgLatency: 0 }
      }
      acc[node.region].count++
      acc[node.region].avgCpu += node.cpuUsage
      acc[node.region].avgMemory += node.memoryUsage
      acc[node.region].avgLatency += node.latency
      return acc
    }, {} as Record<string, { count: number; avgCpu: number; avgMemory: number; avgLatency: number }>)
    
    // Calculate averages
    for (const region of Object.keys(byRegion)) {
      const data = byRegion[region]
      data.avgCpu /= data.count
      data.avgMemory /= data.count
      data.avgLatency /= data.count
    }
    
    return {
      total: nodes.length,
      byRegion,
      nodes,
    }
  })
}
