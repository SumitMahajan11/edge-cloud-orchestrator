import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TaskScheduler } from '../../src/services/task-scheduler'
import type { WebSocketManager } from '../../src/services/websocket-manager'
import type { PrismaClient } from '@prisma/client'
import type { Logger } from 'pino'
import Redis from 'ioredis'

// Mock Redis
vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      set: vi.fn(),
      get: vi.fn(),
      eval: vi.fn(),
      zadd: vi.fn(),
      zrem: vi.fn(),
      zrange: vi.fn(),
      zrevrange: vi.fn(),
      expire: vi.fn(),
      quit: vi.fn(),
    })),
  }
})

// Mock axios
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
  AxiosError: class AxiosError extends Error {},
}))

describe('TaskScheduler', () => {
  let scheduler: TaskScheduler
  let mockPrisma: Partial<PrismaClient>
  let mockRedis: Redis
  let mockWsManager: Partial<WebSocketManager>
  let mockLogger: Logger

  beforeEach(() => {
    mockPrisma = {
      task: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      } as unknown as PrismaClient['task'],
      edgeNode: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      } as unknown as PrismaClient['edgeNode'],
    } as Partial<PrismaClient>

    mockRedis = new Redis()
    mockWsManager = {
      broadcast: vi.fn(),
      sendToNode: vi.fn(),
    }
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger

    scheduler = new TaskScheduler(
      mockPrisma as PrismaClient,
      mockRedis,
      mockWsManager as WebSocketManager,
      mockLogger
    )
  })

  afterEach(async () => {
    await scheduler.stop()
    vi.clearAllMocks()
  })

  describe('Leader Election', () => {
    it('should attempt to become leader on start', async () => {
      vi.mocked(mockRedis.set).mockResolvedValue('OK')
      
      await scheduler.start()
      
      expect(mockRedis.set).toHaveBeenCalledWith(
        'scheduler:leader:lock',
        expect.stringContaining('scheduler-'),
        'PX',
        10000,
        'NX'
      )
    })

    it('should handle leader election failure gracefully', async () => {
      vi.mocked(mockRedis.set).mockResolvedValue(null)
      
      await scheduler.start()
      
      expect(scheduler.isCurrentlyLeader()).toBe(false)
    })

    it('should renew leader lock periodically', async () => {
      vi.useFakeTimers()
      vi.mocked(mockRedis.set).mockResolvedValue('OK')
      vi.mocked(mockRedis.eval).mockResolvedValue(1)
      
      await scheduler.start()
      
      // Fast forward past renewal interval
      await vi.advanceTimersByTimeAsync(6000)
      
      expect(mockRedis.eval).toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('should release leadership on stop', async () => {
      vi.mocked(mockRedis.set).mockResolvedValue('OK')
      vi.mocked(mockRedis.eval).mockResolvedValue(1)
      
      await scheduler.start()
      await scheduler.stop()
      
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('del'),
        1,
        'scheduler:leader:lock',
        expect.any(String)
      )
    })
  })

  describe('Task Queue Operations', () => {
    it('should enqueue task with priority score', async () => {
      const task = {
        id: 'task-1',
        priority: 'HIGH',
        submittedAt: new Date(),
      } as any

      await scheduler.enqueue(task)

      expect(mockRedis.zadd).toHaveBeenCalledWith(
        'task:queue',
        expect.any(Number),
        'task-1'
      )
      expect(mockRedis.expire).toHaveBeenCalledWith('task:queue', 86400)
    })

    it('should dequeue task from queue', async () => {
      await scheduler.dequeue('task-1')

      expect(mockRedis.zrem).toHaveBeenCalledWith('task:queue', 'task-1')
    })

    it('should calculate priority score correctly', async () => {
      const now = Date.now()
      const task = {
        id: 'task-1',
        priority: 'CRITICAL',
        submittedAt: new Date(now - 60000), // 1 minute old
      } as any

      await scheduler.enqueue(task)

      // CRITICAL = 100, plus ~1 point for age = ~101
      const callArgs = vi.mocked(mockRedis.zadd).mock.calls[0]
      expect(callArgs[1]).toBeGreaterThan(100)
      expect(callArgs[1]).toBeLessThanOrEqual(110)
    })
  })

  describe('Scheduler State', () => {
    it('should track instance ID', async () => {
      await scheduler.start()
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: expect.stringContaining('scheduler-'),
        }),
        'Task scheduler started'
      )
    })

    it('should report leader status correctly', async () => {
      vi.mocked(mockRedis.set).mockResolvedValue('OK')
      
      await scheduler.start()
      
      expect(scheduler.isCurrentlyLeader()).toBe(true)
    })
  })
})
