import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestApp, teardownTestApp, TestContext } from "./helpers";

describe("Tenant Data Isolation (V1 API)", () => {
  let ctx: TestContext;
  const JWT_SECRET = "a".repeat(32); // Must match helpers.ts

  const tenantA = "tenant-a";
  const tenantB = "tenant-b";
  const ISSUER = "edge-cloud-orchestrator";
  const AUDIENCE = "edge-cloud-clients";

  // Custom tokens for specific tenants
  const tokenA = jwt.sign(
    {
      id: "user-a",
      email: "a@tenant-a.com",
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
      email: "b@tenant-b.com",
      role: "OPERATOR",
      tenantId: tenantB,
      permissions: ["*"],
      jti: "jti-b",
    },
    JWT_SECRET,
    { issuer: ISSUER, audience: AUDIENCE },
  );

  beforeAll(async () => {
    ctx = await setupTestApp();

    // Seed tenants to satisfy foreign key constraints in SQLite
    await ctx.prisma.tenant.upsert({
      where: { id: tenantA },
      update: {},
      create: { id: tenantA, name: "Tenant A", slug: "tenant-a", config: "{}" },
    });
    await ctx.prisma.tenant.upsert({
      where: { id: tenantB },
      update: {},
      create: { id: tenantB, name: "Tenant B", slug: "tenant-b", config: "{}" },
    });

    // Seed users to satisfy foreign key constraints in SQLite
    await ctx.prisma.user.upsert({
      where: { id: "user-a" },
      update: {},
      create: {
        id: "user-a",
        email: "a@tenant-a.com",
        passwordHash: "dummy-hash",
        name: "User A",
        role: "OPERATOR",
        emailVerified: true,
      },
    });
    await ctx.prisma.user.upsert({
      where: { id: "user-b" },
      update: {},
      create: {
        id: "user-b",
        email: "b@tenant-b.com",
        passwordHash: "dummy-hash",
        name: "User B",
        role: "OPERATOR",
        emailVerified: true,
      },
    });

    // Link users to tenants
    await ctx.prisma.tenantUser.upsert({
      where: { tenantId_userId: { tenantId: tenantA, userId: "user-a" } },
      update: {},
      create: { tenantId: tenantA, userId: "user-a", role: "OPERATOR" },
    });
    await ctx.prisma.tenantUser.upsert({
      where: { tenantId_userId: { tenantId: tenantB, userId: "user-b" } },
      update: {},
      create: { tenantId: tenantB, userId: "user-b", role: "OPERATOR" },
    });

    // Create nodes for Tenant A
    const resNode = await ctx.app.inject({
      method: "POST",
      url: "/v1/nodes",
      headers: { Authorization: `Bearer ${tokenA}` },
      payload: {
        name: "Node-A1",
        location: "US-East",
        region: "us-east-1",
        ipAddress: "1.1.1.1",
        port: 4001,
        cpuCores: 8,
        memoryGB: 16,
        storageGB: 100,
      },
    });
    if (resNode.statusCode !== 201) {
      console.error(
        "FAIL: Node-A1 creation failed. Status:",
        resNode.statusCode,
        "Payload:",
        resNode.payload,
      );
    }
    expect(resNode.statusCode).toBe(201);

    // Create tasks for Tenant A
    const resTaskA = await ctx.app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { Authorization: `Bearer ${tokenA}` },
      payload: {
        name: "Task-A1",
        type: "DATA_PROCESSING",
        priority: "HIGH",
        image: "alpine:latest",
      },
    });
    if (resTaskA.statusCode !== 201) {
      console.error(
        "FAIL: Task-A1 creation failed. Status:",
        resTaskA.statusCode,
        "Payload:",
        resTaskA.payload,
      );
    }
    expect(resTaskA.statusCode).toBe(201);

    // Create tasks for Tenant B
    const resTaskB = await ctx.app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { Authorization: `Bearer ${tokenB}` },
      payload: {
        name: "Task-B1",
        type: "DATA_PROCESSING",
        priority: "LOW",
        image: "alpine:latest",
      },
    });
    if (resTaskB.statusCode !== 201) {
      console.error(
        "FAIL: Task-B1 creation failed. Status:",
        resTaskB.statusCode,
        "Payload:",
        resTaskB.payload,
      );
    }
    expect(resTaskB.statusCode).toBe(201);
  }, 60000);

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  describe("Task Isolation", () => {
    it("Tenant A should see only their tasks", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/v1/tasks",
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      if (res.statusCode !== 200) {
        console.error(
          "FAIL: Tenant A tasks fetch failed. Status:",
          res.statusCode,
          "Payload:",
          JSON.stringify(JSON.parse(res.payload), null, 2),
        );
      }
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe("Task-A1");
    });

    it("Tenant B should see only their tasks", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/v1/tasks",
        headers: { Authorization: `Bearer ${tokenB}` },
      });

      if (res.statusCode !== 200) {
        console.error(
          "FAIL: Tenant B tasks fetch failed. Status:",
          res.statusCode,
          "Payload:",
          JSON.stringify(JSON.parse(res.payload), null, 2),
        );
      }
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe("Task-B1");
    });

    it("Tenant B should get 404 when trying to access Tenant A task by ID", async () => {
      // First find Tenant A task ID
      const resA = await ctx.app.inject({
        method: "GET",
        url: "/v1/tasks",
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      const taskIdA = JSON.parse(resA.payload).data[0].id;

      // Try access with Token B
      const resB = await ctx.app.inject({
        method: "GET",
        url: `/v1/tasks/${taskIdA}`,
        headers: { Authorization: `Bearer ${tokenB}` },
      });

      expect(resB.statusCode).toBe(404);
    });
  });

  describe("Node Isolation", () => {
    it("Tenant B should see no nodes (since we only added for A)", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/v1/nodes",
        headers: { Authorization: `Bearer ${tokenB}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toHaveLength(0);
    });

    it("Tenant A should see their node", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/v1/nodes",
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe("Node-A1");
    });
  });
});
