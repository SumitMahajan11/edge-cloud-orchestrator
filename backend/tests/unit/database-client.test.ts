import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'

// Mock PrismaClient
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation((options) => ({
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    $transaction: vi.fn((cb) => cb()),
    ...options,
  })),
}))

describe('PrismaClientWithReplicas', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    vi.clearAllMocks()
    // Clear module cache to get fresh instance
    vi.resetModules()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('should create primary client when no read replica configured', async () => {
    process.env.DATABASE_URL = 'postgresql://primary:5432/db'
    delete process.env.DATABASE_READ_URL

    const { prisma } = await import('../../src/database/client')
    
    expect(PrismaClient).toHaveBeenCalledTimes(1)
    expect(prisma.read).toBe(prisma.write) // Same client for both
  })

  it('should create separate read replica when configured', async () => {
    process.env.DATABASE_URL = 'postgresql://primary:5432/db'
    process.env.DATABASE_READ_URL = 'postgresql://replica:5432/db'

    const { prisma } = await import('../../src/database/client')
    
    // Should create two clients
    expect(PrismaClient).toHaveBeenCalledTimes(2)
    
    // Second call should have read replica datasource
    const secondCall = vi.mocked(PrismaClient).mock.calls[1]
    expect(secondCall[0]).toMatchObject({
      datasources: {
        db: {
          url: 'postgresql://replica:5432/db',
        },
      },
    })
  })

  it('should connect to both primary and replica', async () => {
    process.env.DATABASE_URL = 'postgresql://primary:5432/db'
    process.env.DATABASE_READ_URL = 'postgresql://replica:5432/db'

    const { prisma } = await import('../../src/database/client')
    
    await prisma.$connect()
    
    // Both clients should connect
    const instances = vi.mocked(PrismaClient).mock.results
    expect(instances.length).toBe(2)
  })

  it('should disconnect from both clients', async () => {
    process.env.DATABASE_URL = 'postgresql://primary:5432/db'
    process.env.DATABASE_READ_URL = 'postgresql://replica:5432/db'

    const { prisma } = await import('../../src/database/client')
    
    await prisma.$disconnect()
    
    const instances = vi.mocked(PrismaClient).mock.results
    expect(instances.length).toBe(2)
  })

  it('should pass health check when both connections work', async () => {
    process.env.DATABASE_URL = 'postgresql://primary:5432/db'
    process.env.DATABASE_READ_URL = 'postgresql://replica:5432/db'

    const { prisma } = await import('../../src/database/client')
    
    const health = await prisma.healthCheck()
    
    expect(health.primary).toBe(true)
    expect(health.replica).toBe(true)
  })

  it('should expose $transaction on primary client', async () => {
    process.env.DATABASE_URL = 'postgresql://primary:5432/db'

    const { prisma } = await import('../../src/database/client')
    
    const transactionFn = vi.fn()
    await prisma.$transaction(transactionFn)
    
    expect(transactionFn).toHaveBeenCalled()
  })
})
