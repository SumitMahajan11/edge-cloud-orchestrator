/**
 * Integration Test Helpers
 * Provides utilities for setting up and tearing down test applications
 */

import { PrismaClient } from '@prisma/client'
import { FastifyInstance } from 'fastify'

import { buildApp } from '../../backend/src/app'

let testApp: FastifyInstance | null = null
let testPrisma: PrismaClient | null = null

export interface TestContext {
  app: FastifyInstance
  prisma: PrismaClient
  accessToken: string
  refreshToken: string
  userId: string
}

/**
 * Setup test application with isolated database
 */
export async function setupTestApp(): Promise<TestContext> {
  // Use test database URL
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/edge_cloud_test'
  process.env.JWT_SECRET = 'test-jwt-secret-key'
  process.env.NODE_ENV = 'test'
  
  const { buildApp } = await import('../../backend/src/app')
  
  testApp = await buildApp({
    logger: false,
  })
  
  testPrisma = new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
  })
  
  // Run migrations
  await testPrisma.$executeRaw`CREATE SCHEMA IF NOT EXISTS public`
  
  // Create test admin user
  const bcrypt = await import('bcryptjs')
  const passwordHash = await bcrypt.hash('testpassword123', 12)
  
  const user = await testPrisma.user.upsert({
    where: { email: 'test-admin@edgecloud.io' },
    update: {},
    create: {
      email: 'test-admin@edgecloud.io',
      passwordHash,
      name: 'Test Admin',
      role: 'ADMIN',
      emailVerified: true,
    },
  })
  
  // Login to get tokens
  const loginRes = await testApp.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: {
      email: 'test-admin@edgecloud.io',
      password: 'testpassword123',
    },
  })
  
  const tokens = JSON.parse(loginRes.payload)
  
  return {
    app: testApp!,
    prisma: testPrisma!,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    userId: user.id,
  }
}

/**
 * Teardown test application
 */
export async function teardownTestApp(ctx: TestContext): Promise<void> {
  // Clean up test data
  if (ctx.prisma) {
    await ctx.prisma.taskLog.deleteMany({})
    await ctx.prisma.task.deleteMany({})
    await ctx.prisma.edgeNode.deleteMany({})
    await ctx.prisma.apiKey.deleteMany({})
    await ctx.prisma.webhook.deleteMany({})
    await ctx.prisma.auditLog.deleteMany({})
    await ctx.prisma.user.deleteMany({})
    await ctx.prisma.$disconnect()
  }
  
  if (ctx.app) {
    await ctx.app.close()
  }
}

/**
 * Wait for a condition with timeout
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 30000, interval = 500 } = options
  const start = Date.now()
  
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  
  throw new Error(`Timeout waiting for condition after ${timeout}ms`)
}

/**
 * Create a test task
 */
export async function createTestTask(
  ctx: TestContext,
  overrides: Record<string, unknown> = {}
): Promise<any> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: { Authorization: `Bearer ${ctx.accessToken}` },
    payload: {
      name: 'Test Task',
      type: 'DATA_PROCESSING',
      priority: 'MEDIUM',
      ...overrides,
    },
  })
  
  if (response.statusCode !== 201) {
    throw new Error(`Failed to create test task: ${response.payload}`)
  }
  
  return JSON.parse(response.payload)
}

/**
 * Create a test node
 */
export async function createTestNode(
  ctx: TestContext,
  overrides: Record<string, unknown> = {}
): Promise<any> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: { Authorization: `Bearer ${ctx.accessToken}` },
    payload: {
      name: `test-node-${Date.now()}`,
      location: 'Test Location',
      region: 'us-east-1',
      ipAddress: '10.0.0.1',
      port: 4001,
      cpuCores: 8,
      memoryGB: 32,
      storageGB: 500,
      ...overrides,
    },
  })
  
  if (response.statusCode !== 201) {
    throw new Error(`Failed to create test node: ${response.payload}`)
  }
  
  return JSON.parse(response.payload)
}
