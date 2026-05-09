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
  process.env.JWT_SECRET = 'test-jwt-secret-key-with-at-least-32-characters'
  process.env.ENCRYPTION_KEY = 'test-encryption-key-with-at-least-32-characters'
  process.env.NODE_ENV = 'test'
  process.env.FORCE_MOCK_DB = 'true'
  process.env.FORCE_MOCK_REDIS = 'true'
  
  let buildApp;
  try {
    const apiModule = await import('../../apps/api/src/index.ts');
    buildApp = apiModule.init;
  } catch (err) {
    console.error('Failed to import API module:', err);
    throw err;
  }
  
  try {
    console.log('[setupTestApp] Building app...');
    testApp = await buildApp();
    testPrisma = (testApp as any).prisma;
  } catch (err) {
    console.error('Failed to initialize test app:', err);
    throw err;
  }
  
  // Create test admin user
  const bcrypt = await import('bcryptjs')
  const passwordHash = await bcrypt.hash('testpassword123', 12)
  
  console.log('[setupTestApp] Upserting admin user...');
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
  console.log('[setupTestApp] Logging in...');
  const loginRes = await testApp.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: {
      email: 'test-admin@edgecloud.io',
      password: 'testpassword123',
    },
  })
  
  console.log('[setupTestApp] Parsing login response...');
  console.log('[setupTestApp] Payload:', loginRes.payload);
  const tokens = JSON.parse(loginRes.payload)
  console.log('[setupTestApp] Tokens:', JSON.stringify(tokens));
  
  return {
    app: testApp!,
    prisma: testPrisma!,
    accessToken: tokens.token,
    refreshToken: tokens.refreshToken,
    userId: user.id,
  }
}

/**
 * Teardown test application
 */
export async function teardownTestApp(ctx?: TestContext): Promise<void> {
  if (!ctx) {
    console.warn('teardownTestApp called without context');
    return;
  }
  // Clean up test data
  if (ctx.prisma) {
    await ctx.prisma.taskExecution.deleteMany({})
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
    url: '/v1/tasks',
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
    url: '/v1/nodes',
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
