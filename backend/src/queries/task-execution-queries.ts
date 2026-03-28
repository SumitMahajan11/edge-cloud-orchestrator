import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ============================================================================
// TaskExecution Entity - Example Queries and Usage
// ============================================================================

/**
 * TASKEXECUTION ENTITY DESIGN
 * 
 * Purpose: Separates "what to run" (Task) from "how it ran" (TaskExecution)
 * 
 * Key Design Decisions:
 * 1. One Task can have multiple TaskExecutions (retries)
 * 2. Each execution captures actual metrics, not estimates
 * 3. Full lifecycle tracking: scheduled → started → completed
 * 4. Links to container runtime information
 * 5. Enables cost tracking and performance analytics
 */

// ============================================================================
// 1. BASIC CRUD OPERATIONS
// ============================================================================

/**
 * Create a new execution when task is scheduled
 */
async function createExecution(taskId: string, nodeId: string): Promise<void> {
  await prisma.taskExecution.create({
    data: {
      taskId,
      nodeId,
      status: 'SCHEDULED',
      scheduledAt: new Date(),
      attemptNumber: await getAttemptNumber(taskId),
    },
  })
}

/**
 * Update execution when container starts
 */
async function markExecutionStarted(
  executionId: string,
  containerId: string,
  image: string
): Promise<void> {
  const now = new Date()
  
  await prisma.taskExecution.update({
    where: { id: executionId },
    data: {
      status: 'RUNNING',
      startedAt: now,
      containerId,
      image,
    },
  })
}

/**
 * Update execution when container completes
 */
async function markExecutionCompleted(
  executionId: string,
  result: {
    exitCode: number
    output?: unknown
    error?: string
    durationMs: number
    resourceUsage: {
      cpuAvg: number
      cpuPeak: number
      memoryMax: number
      networkIn: number
      networkOut: number
    }
    cost: number
  }
): Promise<void> {
  const status = result.exitCode === 0 ? 'COMPLETED' : 'FAILED'
  
  await prisma.taskExecution.update({
    where: { id: executionId },
    data: {
      status,
      completedAt: new Date(),
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      output: result.output as any,
      error: result.error,
      cpuUsageAvg: result.resourceUsage.cpuAvg,
      cpuUsagePeak: result.resourceUsage.cpuPeak,
      memoryUsageMax: result.resourceUsage.memoryMax,
      networkIngressBytes: result.resourceUsage.networkIn,
      networkEgressBytes: result.resourceUsage.networkOut,
      costUSD: result.cost,
    },
  })
}

// ============================================================================
// 2. MONITORING QUERIES
// ============================================================================

/**
 * Get currently running executions
 */
async function getRunningExecutions(): Promise<any[]> {
  return prisma.taskExecution.findMany({
    where: { status: 'RUNNING' },
    include: {
      task: { select: { id: true, name: true, type: true, priority: true } },
      node: { select: { id: true, name: true, region: true } },
    },
    orderBy: { startedAt: 'desc' },
  })
}

/**
 * Get execution statistics for a time period
 */
async function getExecutionStats(
  startDate: Date,
  endDate: Date
): Promise<{
  total: number
  byStatus: Record<string, number>
  avgDuration: number
  avgCost: number
  successRate: number
}> {
  const executions = await prisma.taskExecution.findMany({
    where: {
      completedAt: { gte: startDate, lte: endDate },
    },
    select: {
      status: true,
      durationMs: true,
      costUSD: true,
    },
  })

  const total = executions.length
  const completed = executions.filter(e => e.status === 'COMPLETED').length
  
  const byStatus = executions.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const durations = executions.filter(e => e.durationMs).map(e => e.durationMs!)
  const avgDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0

  const costs = executions.filter(e => e.costUSD).map(e => e.costUSD!)
  const avgCost = costs.length > 0
    ? costs.reduce((a, b) => a + b, 0) / costs.length
    : 0

  return {
    total,
    byStatus,
    avgDuration,
    avgCost,
    successRate: total > 0 ? completed / total : 0,
  }
}

/**
 * Get executions that have been running too long (potential hangs)
 */
async function getStuckExecutions(
  maxDurationMinutes: number = 30
): Promise<any[]> {
  const cutoff = new Date(Date.now() - maxDurationMinutes * 60 * 1000)
  
  return prisma.taskExecution.findMany({
    where: {
      status: 'RUNNING',
      startedAt: { lt: cutoff },
    },
    include: {
      task: { select: { id: true, name: true } },
      node: { select: { id: true, name: true } },
    },
  })
}

// ============================================================================
// 3. ANALYTICS QUERIES
// ============================================================================

/**
 * Get performance metrics by task type
 */
async function getPerformanceByTaskType(): Promise<any[]> {
  return prisma.$queryRaw`
    SELECT 
      t.type as taskType,
      COUNT(*) as executionCount,
      AVG(e.duration_ms) as avgDurationMs,
      AVG(e.cpu_usage_avg) as avgCpuUsage,
      AVG(e.memory_usage_max) as avgMemoryUsage,
      AVG(e.cost_usd) as avgCost,
      SUM(CASE WHEN e.status = 'COMPLETED' THEN 1 ELSE 0 END)::float / COUNT(*) as successRate
    FROM task_executions e
    JOIN tasks t ON e.task_id = t.id
    WHERE e.completed_at IS NOT NULL
    GROUP BY t.type
    ORDER BY executionCount DESC
  `
}

/**
 * Get performance metrics by node
 */
async function getPerformanceByNode(): Promise<any[]> {
  return prisma.$queryRaw`
    SELECT 
      n.id as nodeId,
      n.name as nodeName,
      n.region,
      COUNT(e.id) as executionCount,
      AVG(e.duration_ms) as avgDurationMs,
      AVG(e.cpu_usage_avg) as avgCpuUsage,
      AVG(e.memory_usage_max) as avgMemoryUsage,
      SUM(e.cost_usd) as totalCost,
      SUM(CASE WHEN e.status = 'COMPLETED' THEN 1 ELSE 0 END)::float / COUNT(*) as successRate
    FROM task_executions e
    JOIN edge_nodes n ON e.node_id = n.id
    WHERE e.completed_at IS NOT NULL
    GROUP BY n.id, n.name, n.region
    ORDER BY executionCount DESC
  `
}

/**
 * Get execution timeline for a task (all attempts)
 */
async function getTaskExecutionHistory(taskId: string): Promise<any> {
  const [task, executions] = await Promise.all([
    prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, name: true, type: true, status: true, submittedAt: true },
    }),
    prisma.taskExecution.findMany({
      where: { taskId },
      include: {
        node: { select: { id: true, name: true, region: true } },
        logs: {
          select: { timestamp: true, level: true, message: true },
          orderBy: { timestamp: 'asc' },
          take: 100,
        },
      },
      orderBy: { attemptNumber: 'asc' },
    }),
  ])

  return {
    task,
    executions,
    totalAttempts: executions.length,
    totalDuration: executions.reduce((sum, e) => sum + (e.durationMs || 0), 0),
    totalCost: executions.reduce((sum, e) => sum + (e.costUSD || 0), 0),
  }
}

/**
 * Get cost breakdown over time
 */
async function getCostTrend(
  startDate: Date,
  endDate: Date,
  groupBy: 'day' | 'week' | 'month' = 'day'
): Promise<any[]> {
  const dateFormat = groupBy === 'day' 
    ? 'YYYY-MM-DD' 
    : groupBy === 'week' 
      ? 'IYYY-IW' 
      : 'YYYY-MM'

  return prisma.$queryRaw`
    SELECT 
      TO_CHAR(completed_at, ${dateFormat}) as period,
      COUNT(*) as executionCount,
      SUM(cost_usd) as totalCost,
      AVG(cost_usd) as avgCost,
      SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as successCount,
      SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failedCount
    FROM task_executions
    WHERE completed_at BETWEEN ${startDate} AND ${endDate}
    GROUP BY TO_CHAR(completed_at, ${dateFormat})
    ORDER BY period ASC
  `
}

/**
 * Get resource usage patterns
 */
async function getResourceUsagePatterns(): Promise<{
  peakHours: Array<{ hour: number; count: number }>
  avgCpuByHour: Array<{ hour: number; avgCpu: number }>
  avgMemoryByHour: Array<{ hour: number; avgMemory: number }>
}> {
  const [peakHours, cpuByHour, memoryByHour] = await Promise.all([
    prisma.$queryRaw<Array<{ hour: number; count: bigint }>>`
      SELECT EXTRACT(HOUR FROM started_at) as hour, COUNT(*) as count
      FROM task_executions
      WHERE started_at IS NOT NULL
      GROUP BY EXTRACT(HOUR FROM started_at)
      ORDER BY count DESC
    `,
    prisma.$queryRaw<Array<{ hour: number; avgCpu: number }>>`
      SELECT EXTRACT(HOUR FROM started_at) as hour, AVG(cpu_usage_avg) as avgCpu
      FROM task_executions
      WHERE started_at IS NOT NULL AND cpu_usage_avg IS NOT NULL
      GROUP BY EXTRACT(HOUR FROM started_at)
      ORDER BY hour ASC
    `,
    prisma.$queryRaw<Array<{ hour: number; avgMemory: number }>>`
      SELECT EXTRACT(HOUR FROM started_at) as hour, AVG(memory_usage_max) as avgMemory
      FROM task_executions
      WHERE started_at IS NOT NULL AND memory_usage_max IS NOT NULL
      GROUP BY EXTRACT(HOUR FROM started_at)
      ORDER BY hour ASC
    `,
  ])

  return {
    peakHours: peakHours.map(h => ({ hour: Number(h.hour), count: Number(h.count) })),
    avgCpuByHour: cpuByHour.map(h => ({ hour: Number(h.hour), avgCpu: h.avgCpu })),
    avgMemoryByHour: memoryByHour.map(h => ({ hour: Number(h.hour), avgMemory: h.avgMemory })),
  }
}

// ============================================================================
// 4. RELATIONSHIP QUERIES
// ============================================================================

/**
 * Get full execution details with all relationships
 */
async function getFullExecutionDetails(executionId: string): Promise<any> {
  return prisma.taskExecution.findUnique({
    where: { id: executionId },
    include: {
      task: {
        select: {
          id: true,
          name: true,
          type: true,
          priority: true,
          input: true,
          submittedAt: true,
        },
      },
      node: {
        select: {
          id: true,
          name: true,
          region: true,
          status: true,
        },
      },
      logs: {
        select: {
          timestamp: true,
          level: true,
          source: true,
          message: true,
        },
        orderBy: { timestamp: 'asc' },
      },
    },
  })
}

/**
 * Get node's recent executions
 */
async function getNodeRecentExecutions(
  nodeId: string,
  limit: number = 20
): Promise<any[]> {
  return prisma.taskExecution.findMany({
    where: { nodeId },
    include: {
      task: { select: { id: true, name: true, type: true } },
    },
    orderBy: { scheduledAt: 'desc' },
    take: limit,
  })
}

/**
 * Get task's current execution (if running)
 */
async function getTaskCurrentExecution(taskId: string): Promise<any> {
  return prisma.taskExecution.findFirst({
    where: {
      taskId,
      status: { in: ['SCHEDULED', 'RUNNING'] },
    },
    include: {
      node: { select: { id: true, name: true, region: true } },
    },
    orderBy: { scheduledAt: 'desc' },
  })
}

// ============================================================================
// 5. RETRY AND FAILURE ANALYSIS
// ============================================================================

/**
 * Get failed executions for retry
 */
async function getFailedExecutionsForRetry(
  maxRetries: number = 3
): Promise<any[]> {
  return prisma.$queryRaw`
    SELECT e.*, t.name as task_name, t.type as task_type
    FROM task_executions e
    JOIN tasks t ON e.task_id = t.id
    WHERE e.status = 'FAILED'
      AND e.attempt_number < ${maxRetries}
      AND NOT EXISTS (
        SELECT 1 FROM task_executions e2 
        WHERE e2.task_id = e.task_id 
        AND e2.attempt_number > e.attempt_number
      )
    ORDER BY e.completed_at ASC
  `
}

/**
 * Get failure analysis by error type
 */
async function getFailureAnalysis(): Promise<any[]> {
  return prisma.$queryRaw`
    SELECT 
      SPLIT_PART(error, ':', 1) as errorType,
      COUNT(*) as failureCount,
      ARRAY_AGG(DISTINCT t.type) as affectedTaskTypes,
      AVG(e.duration_ms) as avgDurationBeforeFailure
    FROM task_executions e
    JOIN tasks t ON e.task_id = t.id
    WHERE e.status = 'FAILED' AND e.error IS NOT NULL
    GROUP BY SPLIT_PART(error, ':', 1)
    ORDER BY failureCount DESC
  `
}

/**
 * Get retry success rate
 */
async function getRetrySuccessRate(): Promise<{
  overall: number
  byAttempt: Array<{ attempt: number; successRate: number; count: number }>
}> {
  const [overall, byAttempt] = await Promise.all([
    prisma.$queryRaw<Array<{ rate: number }>>`
      SELECT 
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END)::float / COUNT(*) as rate
      FROM task_executions
      WHERE attempt_number > 1
    `,
    prisma.$queryRaw<Array<{ attempt: number; successRate: number; count: bigint }>>`
      SELECT 
        attempt_number as attempt,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END)::float / COUNT(*) as successRate,
        COUNT(*) as count
      FROM task_executions
      GROUP BY attempt_number
      ORDER BY attempt_number ASC
    `,
  ])

  return {
    overall: overall[0]?.rate || 0,
    byAttempt: byAttempt.map(a => ({
      attempt: Number(a.attempt),
      successRate: a.successRate,
      count: Number(a.count),
    })),
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function getAttemptNumber(taskId: string): Promise<number> {
  const lastExecution = await prisma.taskExecution.findFirst({
    where: { taskId },
    orderBy: { attemptNumber: 'desc' },
    select: { attemptNumber: true },
  })
  return (lastExecution?.attemptNumber || 0) + 1
}

// ============================================================================
// EXPORTS
// ============================================================================

export const TaskExecutionQueries = {
  // Basic operations
  createExecution,
  markExecutionStarted,
  markExecutionCompleted,
  
  // Monitoring
  getRunningExecutions,
  getExecutionStats,
  getStuckExecutions,
  
  // Analytics
  getPerformanceByTaskType,
  getPerformanceByNode,
  getTaskExecutionHistory,
  getCostTrend,
  getResourceUsagePatterns,
  
  // Relationships
  getFullExecutionDetails,
  getNodeRecentExecutions,
  getTaskCurrentExecution,
  
  // Retry analysis
  getFailedExecutionsForRetry,
  getFailureAnalysis,
  getRetrySuccessRate,
}
