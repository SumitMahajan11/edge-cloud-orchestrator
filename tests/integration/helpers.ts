/**
 * Integration Test Helpers
 * Provides utilities for setting up and tearing down test applications
 */

import { PrismaClient } from "@prisma/client";
import { FastifyInstance } from "fastify";
import fs from "fs";
import path from "path";


let testApp: FastifyInstance | null = null;
let testPrisma: PrismaClient | null = null;

export interface TestContext {
  app: FastifyInstance;
  prisma: PrismaClient;
  accessToken: string;
  refreshToken: string;
  userId: string;
  tenantId: string;
}

/**
 * Setup test application with isolated database
 */
export async function setupTestApp(): Promise<TestContext> {
  const workerId = process.env.VITEST_WORKER_ID || "0";
  const tmpDir = path.resolve(__dirname, "../tmp");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const dbPath = path.resolve(tmpDir, `test-${workerId}.db`);

  // Use worker-specific SQLite database URL
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.JWT_SECRET = "a".repeat(32);
  process.env.ENCRYPTION_KEY = "b".repeat(32);
  process.env.NODE_ENV = "test";
  process.env.FORCE_MOCK_DB = "false";
  process.env.FORCE_MOCK_REDIS = "true";
  process.env.ALLOW_PRIVATE_IPS = "true";
  process.env.WS_PORT = "0"; // Ephemeral port for websocket server

  // Run migrations/push dynamically on the SQLite DB
  const schemaPath = path.resolve(__dirname, "./client/schema.prisma");
  try {
    const { execSync } = await import("child_process");
    execSync(
      `pnpm exec prisma db push --schema=${schemaPath} --force-reset --accept-data-loss --skip-generate`,
      {
        stdio: "pipe",
        env: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL,
        },
      },
    );
  } catch (error: any) {
    console.error(
      "Prisma db push failed:",
      error.stdout?.toString(),
      error.stderr?.toString(),
    );
    throw error;
  }

  let buildApp;
  try {
    const apiModule = await import("../../apps/api/src/index.ts");
    buildApp = apiModule.init;
  } catch (err) {
    console.error("Failed to import API module:", err);
    throw err;
  }

  try {
    console.log("[setupTestApp] Building app...");
    testApp = await buildApp();
    testPrisma = (testApp as any).prisma;
  } catch (err) {
    console.error("Failed to initialize test app:", err);
    throw err;
  }

  // Create test admin user
  const bcrypt = await import("bcryptjs");
  const passwordHash = await bcrypt.hash("testpassword123", 12);
  const adminPasswordHash = await bcrypt.hash("admin123", 12);

  console.log("[setupTestApp] Upserting admin users...");
  const user = await testPrisma.user.upsert({
    where: { email: "test-admin@edgecloud.io" },
    update: {},
    create: {
      email: "test-admin@edgecloud.io",
      passwordHash,
      name: "Test Admin",
      role: "ADMIN",
      emailVerified: true,
    },
  });

  const adminUser = await testPrisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      email: "admin@example.com",
      passwordHash: adminPasswordHash,
      name: "System Administrator",
      role: "ADMIN",
      emailVerified: true,
    },
  });

  // Create a default tenant and associate users with it
  console.log("[setupTestApp] Upserting default tenant and user linkages...");
  const tenant = await (testPrisma as any).tenant.upsert({
    where: { slug: "default-tenant" },
    update: {},
    create: {
      name: "Default Tenant",
      slug: "default-tenant",
      config: "{}",
      isActive: true,
    },
  });

  await (testPrisma as any).tenantUser.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: user.id,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: user.id,
      role: "ADMIN",
    },
  });

  await (testPrisma as any).tenantUser.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: adminUser.id,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: adminUser.id,
      role: "ADMIN",
    },
  });

  // Login to get tokens
  console.log("[setupTestApp] Logging in...");
  const loginRes = await testApp.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: {
      email: "test-admin@edgecloud.io",
      password: "testpassword123",
    },
  });

  console.log("[setupTestApp] Parsing login response...");
  console.log("[setupTestApp] Payload:", loginRes.payload);
  const tokens = JSON.parse(loginRes.payload);
  console.log("[setupTestApp] Tokens:", JSON.stringify(tokens));

  return {
    app: testApp,
    prisma: testPrisma!,
    accessToken: tokens.token,
    refreshToken: tokens.refreshToken,
    userId: user.id,
    tenantId: tenant.id,
  };
}

/**
 * Teardown test application
 */
export async function teardownTestApp(ctx?: TestContext): Promise<void> {
  if (!ctx) {
    console.warn("teardownTestApp called without context");
    return;
  }

  // 1. Close Fastify app first. This stops all background loops, jobs, monitors,
  // and the scheduler. It also closes HTTP connections safely.
  if (ctx.app) {
    try {
      await ctx.app.close();
    } catch (e) {
      console.warn("Error closing fastify app:", e);
    }
  }

  // 2. Disconnect prisma client
  if (ctx.prisma) {
    try {
      await ctx.prisma.$disconnect();
    } catch (e) {
      console.warn("Error disconnecting prisma:", e);
    }
  }

  // 3. Delete worker-specific DB file with retry to handle Windows file locks
  const workerId = process.env.VITEST_WORKER_ID || "0";
  const dbPath = path.resolve(__dirname, `../tmp/test-${workerId}.db`);
  
  // Wait a short bit to let the OS release the file handles
  await new Promise((resolve) => setTimeout(resolve, 500));

  for (let i = 0; i < 10; i++) {
    try {
      if (fs.existsSync(dbPath)) {
        fs.rmSync(dbPath, { force: true });
      }
      break;
    } catch (err) {
      if (i === 9) {
        console.error(
          `Failed to delete database file ${dbPath} after 10 attempts:`,
          err,
        );
      } else {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  }
}

/**
 * Wait for a condition with timeout
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  options: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const { timeout = 30000, interval = 500 } = options;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

/**
 * Create a test task
 */
export async function createTestTask(
  ctx: TestContext,
  overrides: Record<string, unknown> = {},
): Promise<any> {
  const response = await ctx.app.inject({
    method: "POST",
    url: "/v1/tasks",
    headers: { Authorization: `Bearer ${ctx.accessToken}` },
    payload: {
      name: "Test Task",
      type: "DATA_PROCESSING",
      priority: "MEDIUM",
      image: "ubuntu:latest",
      ...overrides,
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`Failed to create test task: ${response.payload}`);
  }

  return JSON.parse(response.payload);
}

/**
 * Create a test node
 */
export async function createTestNode(
  ctx: TestContext,
  overrides: Record<string, unknown> = {},
): Promise<any> {
  const response = await ctx.app.inject({
    method: "POST",
    url: "/v1/nodes",
    headers: { Authorization: `Bearer ${ctx.accessToken}` },
    payload: {
      name: `test-node-${Date.now()}`,
      location: "Test Location",
      region: "us-east-1",
      ipAddress: "10.0.0.1",
      port: 4001,
      cpuCores: 8,
      memoryGB: 32,
      storageGB: 500,
      ...overrides,
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`Failed to create test node: ${response.payload}`);
  }

  const node = JSON.parse(response.payload);

  // Update node status to ONLINE to bypass default OFFLINE status on register
  await ctx.prisma.edgeNode.update({
    where: { id: node.id },
    data: { status: "ONLINE" },
  });

  return { ...node, status: "ONLINE" };
}
