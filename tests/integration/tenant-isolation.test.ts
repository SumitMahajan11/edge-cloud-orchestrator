process.env.NODE_ENV = 'test';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
vi.unmock('fastify-plugin');
import Fastify, { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import jwt from 'jsonwebtoken';
import { prismaPlugin } from '../../apps/api/src/plugins/prisma';
import { authPlugin } from '../../apps/api/src/plugins/auth';
import v2Routes from '../../apps/api/src/routes/v2-manifest';
import path from 'path';
import fs from 'fs';

describe('Tenant Isolation Integration Tests', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  const JWT_SECRET = process.env.JWT_SECRET!;
  const DB_PATH = path.resolve(__dirname, './prisma/test.db');
  const SCHEMA_PATH = path.resolve(__dirname, './prisma/schema.prisma');
  
  // Fixtures
  const tenantA = 'tenant-a';
  const tenantB = 'tenant-b';
  
  const tokenA = jwt.sign({ id: 'user-a', email: 'a@tenant.com', role: 'OPERATOR', tenantId: tenantA, permissions: ['*'] }, JWT_SECRET);
  const tokenB = jwt.sign({ id: 'user-b', email: 'b@tenant.com', role: 'OPERATOR', tenantId: tenantB, permissions: ['*'] }, JWT_SECRET);
  const adminToken = jwt.sign({ id: 'admin', email: 'admin@system.com', role: 'ADMIN', permissions: ['*'] }, JWT_SECRET);

  beforeAll(async () => {
    // 1. Cleanup old DB
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

    // 2. Run migrations/push
    try {
      execSync(`pnpm exec prisma db push --schema=${SCHEMA_PATH} --force-reset --accept-data-loss`, {
        stdio: 'pipe'
      });
    } catch (error: any) {
      console.error('Prisma db push failed:', error.stdout?.toString(), error.stderr?.toString());
      throw error;
    }

    // Generate client for this specific schema if needed, 
    // but usually the default client works if models match enough
    // However, to be safe, we'll use the default client and assume the models we use exist.
    prisma = new PrismaClient({ 
      datasources: { db: { url: `file:${DB_PATH}` } }
    });

    // 3. Setup Fastify
    app = Fastify({
      logger: {
        level: 'info'
      }
    });
    
    await app.register(import('@fastify/jwt'), { secret: JWT_SECRET });
    await app.register(prismaPlugin, { prisma });
    
    // Register our new tenant scope plugin
    const { tenantScopePlugin } = await import('../../apps/api/src/middleware/tenant-scope');
    await app.register(tenantScopePlugin);
    
    await app.register(authPlugin);
    
    // Ensure decorators are present even if fastify-plugin mock caused issues
    if (!app.authenticate) {
      const { authenticate, requireRole } = await import('../../apps/api/src/middleware/auth.middleware');
      app.decorate('authenticate', authenticate);
      app.decorate('requireRole', requireRole);
    }
    app.decorate('redis', {
      get: async () => null,
      set: async () => 'OK',
      publish: async () => 0,
      subscribe: async () => {},
      on: () => {},
      off: () => {},
      del: async () => 1,
    });
    
    app.decorate('wsManager', { broadcast: () => {} });
    app.decorate('taskScheduler', { enqueue: async () => {} });
    app.decorate('idempotencyService', { check: async () => null, commit: async () => {} });

    await app.register(v2Routes, { prefix: '/v2' });
    await app.ready();

    // 4. Seed basic data (Tenants)
    await prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'Tenant A', slug: 'tenant-a', config: '{}' },
        { id: tenantB, name: 'Tenant B', slug: 'tenant-b', config: '{}' },
      ]
    });

    // 5. Seed Edge Nodes
    await prisma.edgeNode.createMany({
      data: [
        { id: 'node-a1', name: 'Node A1', location: 'loc', region: 'reg', ipAddress: '1.1.1.1', port: 1, url: 'http://1', cpuCores: 1, memoryGB: 1, storageGB: 1, tenantId: tenantA },
        { id: 'node-b1', name: 'Node B1', location: 'loc', region: 'reg', ipAddress: '2.2.2.2', port: 2, url: 'http://2', cpuCores: 1, memoryGB: 1, storageGB: 1, tenantId: tenantB },
      ]
    });

    // 6. Seed Tasks
    await prisma.task.createMany({
      data: [
        { name: 'Task A1', type: 'CUSTOM', tenantId: tenantA, policy: 'manual', reason: 'test', target: 'EDGE' },
        { name: 'Task A2', type: 'CUSTOM', tenantId: tenantA, policy: 'manual', reason: 'test', target: 'EDGE' },
        { name: 'Task A3', type: 'CUSTOM', tenantId: tenantA, policy: 'manual', reason: 'test', target: 'EDGE' },
        { name: 'Task B1', type: 'CUSTOM', tenantId: tenantB, policy: 'manual', reason: 'test', target: 'EDGE' },
        { name: 'Task B2', type: 'CUSTOM', tenantId: tenantB, policy: 'manual', reason: 'test', target: 'EDGE' },
        { name: 'Task B3', type: 'CUSTOM', tenantId: tenantB, policy: 'manual', reason: 'test', target: 'EDGE' },
      ]
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  });

  describe('TASK ISOLATION', () => {
    it('should only return tasks belonging to the authenticated tenant', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v2/tasks',
        headers: { Authorization: `Bearer ${tokenA}` }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      // If isolation is working via prismaForTenant, it should return 3
      expect(body.data).toHaveLength(3);
    });
  });

  describe('NODE ISOLATION', () => {
    it('should only return nodes belonging to the authenticated tenant', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v2/nodes',
        headers: { Authorization: `Bearer ${tokenB}` }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      // If isolation is working, it should return 1
      expect(body.data).toHaveLength(1);
    });
  });

  describe('CROSS-TENANT ACCESS', () => {
    it('should return 404 when reading a task from another tenant', async () => {
      // Get task from tenant A
      const taskA = await prisma.task.findFirst({ where: { tenantId: tenantA } });
      
      // Try to read it with tenant B's token
      const res = await app.inject({
        method: 'GET',
        url: `/v2/tasks/${taskA?.id}`,
        headers: { Authorization: `Bearer ${tokenB}` }
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('ADMIN BYPASS', () => {
    it('should return all tasks when authenticated as SUPER_ADMIN', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v2/tasks',
        headers: { Authorization: `Bearer ${adminToken}` }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      // Should see all 6 tasks
      expect(body.data.length).toBeGreaterThanOrEqual(6);
    });
  });
});
