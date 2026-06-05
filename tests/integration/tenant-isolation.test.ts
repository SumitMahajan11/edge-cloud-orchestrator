import { afterAll, beforeAll, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { setupTestApp, teardownTestApp, TestContext } from "./helpers";

describe("Tenant Isolation Integration Tests", () => {
  let ctx: TestContext;
  const JWT_SECRET = "a".repeat(32); // Must match helpers.ts
  const ISSUER = "edge-cloud-orchestrator";
  const AUDIENCE = "edge-cloud-clients";

  const tenantA = "tenant-a";
  const tenantB = "tenant-b";

  const tokenA = jwt.sign(
    {
      id: "user-a",
      email: "a@tenant.com",
      role: "OPERATOR",
      tenantId: tenantA,
      permissions: ["*"],
      jti: "jti-a",
    },
    JWT_SECRET,
    { issuer: ISSUER, audience: AUDIENCE },
  );

  const tokenB = jwt.sign(
    {
      id: "user-b",
      email: "b@tenant.com",
      role: "OPERATOR",
      tenantId: tenantB,
      permissions: ["*"],
      jti: "jti-b",
    },
    JWT_SECRET,
    { issuer: ISSUER, audience: AUDIENCE },
  );

  const adminToken = jwt.sign(
    {
      id: "admin",
      email: "admin@system.com",
      role: "ADMIN",
      permissions: ["*"],
      jti: "jti-admin",
    },
    JWT_SECRET,
    { issuer: ISSUER, audience: AUDIENCE },
  );

  beforeAll(async () => {
    ctx = await setupTestApp();

    // 4. Seed basic data (Tenants)
    await ctx.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: "Tenant A", slug: "tenant-a", config: "{}" },
        { id: tenantB, name: "Tenant B", slug: "tenant-b", config: "{}" },
      ],
    });

    // Seed users to satisfy foreign key constraints
    await ctx.prisma.user.createMany({
      data: [
        {
          id: "user-a",
          email: "a@tenant.com",
          passwordHash: "dummy",
          name: "User A",
          role: "OPERATOR",
          emailVerified: true,
        },
        {
          id: "user-b",
          email: "b@tenant.com",
          passwordHash: "dummy",
          name: "User B",
          role: "OPERATOR",
          emailVerified: true,
        },
        {
          id: "admin",
          email: "admin@system.com",
          passwordHash: "dummy",
          name: "Admin",
          role: "ADMIN",
          emailVerified: true,
        },
      ],
    });

    // Seed tenantUsers
    await ctx.prisma.tenantUser.createMany({
      data: [
        { tenantId: tenantA, userId: "user-a", role: "OPERATOR" },
        { tenantId: tenantB, userId: "user-b", role: "OPERATOR" },
      ],
    });

    // 5. Seed Edge Nodes
    await ctx.prisma.edgeNode.createMany({
      data: [
        {
          id: "node-a1",
          name: "Node A1",
          location: "loc",
          region: "reg",
          ipAddress: "1.1.1.1",
          port: 1,
          url: "http://1",
          cpuCores: 1,
          memoryGB: 1,
          storageGB: 1,
          tenantId: tenantA,
        },
        {
          id: "node-b1",
          name: "Node B1",
          location: "loc",
          region: "reg",
          ipAddress: "2.2.2.2",
          port: 2,
          url: "http://2",
          cpuCores: 1,
          memoryGB: 1,
          storageGB: 1,
          tenantId: tenantB,
        },
      ],
    });

    // 6. Seed Tasks
    await ctx.prisma.task.createMany({
      data: [
        {
          name: "Task A1",
          type: "CUSTOM",
          tenantId: tenantA,
          policy: "manual",
          reason: "test",
          target: "EDGE",
        },
        {
          name: "Task A2",
          type: "CUSTOM",
          tenantId: tenantA,
          policy: "manual",
          reason: "test",
          target: "EDGE",
        },
        {
          name: "Task A3",
          type: "CUSTOM",
          tenantId: tenantA,
          policy: "manual",
          reason: "test",
          target: "EDGE",
        },
        {
          name: "Task B1",
          type: "CUSTOM",
          tenantId: tenantB,
          policy: "manual",
          reason: "test",
          target: "EDGE",
        },
        {
          name: "Task B2",
          type: "CUSTOM",
          tenantId: tenantB,
          policy: "manual",
          reason: "test",
          target: "EDGE",
        },
        {
          name: "Task B3",
          type: "CUSTOM",
          tenantId: tenantB,
          policy: "manual",
          reason: "test",
          target: "EDGE",
        },
      ],
    });
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  describe("TASK ISOLATION", () => {
    it("should only return tasks belonging to the authenticated tenant", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/v2/tasks",
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toHaveLength(3);
    });
  });

  describe("NODE ISOLATION", () => {
    it("should only return nodes belonging to the authenticated tenant", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/v2/nodes",
        headers: { Authorization: `Bearer ${tokenB}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toHaveLength(1);
    });
  });

  describe("CROSS-TENANT ACCESS", () => {
    it("should return 404 when reading a task from another tenant", async () => {
      const taskA = await ctx.prisma.task.findFirst({
        where: { tenantId: tenantA },
      });

      const res = await ctx.app.inject({
        method: "GET",
        url: `/v2/tasks/${taskA?.id}`,
        headers: { Authorization: `Bearer ${tokenB}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("ADMIN BYPASS", () => {
    it("should return all tasks when authenticated as SUPER_ADMIN", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/v2/tasks",
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.length).toBeGreaterThanOrEqual(6);
    });
  });
});
