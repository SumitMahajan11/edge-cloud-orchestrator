import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestApp, teardownTestApp, TestContext } from "./helpers";

describe("Carbon Compliance Reporting", () => {
  let ctx: TestContext;
  const JWT_SECRET = "a".repeat(32); // Must match helpers.ts

  const tenantA = "tenant-a";
  const tenantB = "tenant-b";
  const ISSUER = "edge-cloud-orchestrator";
  const AUDIENCE = "edge-cloud-clients";

  // Tokens for specific tenants
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

  const _tokenB = jwt.sign(
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

    // Seed tenants to satisfy foreign key constraints
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

    // Seed users to satisfy foreign key constraints
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

    // Seed Tasks to satisfy CarbonRecord taskId unique constraint
    await ctx.prisma.task.createMany({
      data: [
        {
          id: "task-a1",
          tenantId: tenantA,
          name: "Task A1",
          type: "MODEL_INFERENCE",
          priority: "HIGH",
          status: "COMPLETED",
          target: "EDGE",
          policy: "manual",
          reason: "test",
        },
        {
          id: "task-a2",
          tenantId: tenantA,
          name: "Task A2",
          type: "ML_TRAINING",
          priority: "MEDIUM",
          status: "COMPLETED",
          target: "EDGE",
          policy: "manual",
          reason: "test",
        },
        {
          id: "task-b1",
          tenantId: tenantB,
          name: "Task B1",
          type: "DATA_PROCESSING",
          priority: "LOW",
          status: "COMPLETED",
          target: "EDGE",
          policy: "manual",
          reason: "test",
        },
      ],
    });

    // Seed CarbonRecords directly (using any/unsafe cast to avoid TS issues if client hasn't rebuilt schema yet)
    await (ctx.prisma as any).carbonRecord.createMany({
      data: [
        {
          id: "record-a1",
          taskId: "task-a1",
          tenantId: tenantA,
          nodeId: "node-a1",
          region: "us-east-1",
          carbonIntensity: 350.0,
          durationMs: 3600000,
          estimatedGco2eq: 35.0,
          estimatedWatts: 100.0,
          wasDeferred: true,
          baselineGco2eq: 50.0,
          carbonSavedGco2eq: 15.0,
          recordedAt: new Date(),
        },
        {
          id: "record-a2",
          taskId: "task-a2",
          tenantId: tenantA,
          nodeId: "node-a2",
          region: "eu-west-1",
          carbonIntensity: 100.0,
          durationMs: 7200000,
          estimatedGco2eq: 14.4,
          estimatedWatts: 20.0,
          wasDeferred: false,
          baselineGco2eq: null,
          carbonSavedGco2eq: null,
          recordedAt: new Date(),
        },
        {
          id: "record-b1",
          taskId: "task-b1",
          tenantId: tenantB,
          nodeId: "node-b1",
          region: "us-west-2",
          carbonIntensity: 200.0,
          durationMs: 3600000,
          estimatedGco2eq: 20.0,
          estimatedWatts: 100.0,
          wasDeferred: false,
          baselineGco2eq: null,
          carbonSavedGco2eq: null,
          recordedAt: new Date(),
        },
      ],
    });
  }, 60000);

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  it("should enforce tenant data isolation for carbon reports", async () => {
    const resA = await ctx.app.inject({
      method: "GET",
      url: "/v2/carbon/report",
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    expect(resA.statusCode).toBe(200);
    const bodyA = JSON.parse(resA.payload);

    // Tenant A should only see task-a1 and task-a2
    expect(bodyA.summary.totalTasks).toBe(2);
    expect(bodyA.workloads).toHaveLength(2);
    expect(bodyA.workloads.map((r: any) => r.taskId)).toContain("task-a1");
    expect(bodyA.workloads.map((r: any) => r.taskId)).toContain("task-a2");
    expect(bodyA.workloads.map((r: any) => r.taskId)).not.toContain("task-b1");

    // Check calculations
    // totalGco2eq = 35.0 + 14.4 = 49.4
    // totalBaselineGco2eq = 50.0 + 14.4 (defaults to estimatedGco2eq because baseline is null) = 64.4
    // totalSavedGco2eq = 15.0 + 0.0 = 15.0
    expect(bodyA.summary.totalGco2eq).toBeCloseTo(49.4, 1);
    expect(bodyA.summary.totalBaselineGco2eq).toBeCloseTo(64.4, 1);
    expect(bodyA.summary.totalSavedGco2eq).toBeCloseTo(15.0, 1);
    expect(bodyA.summary.deferredTasks).toBe(1);

    // Check breakdown by workload type
    expect(bodyA.breakdown.MODEL_INFERENCE.taskCount).toBe(1);
    expect(bodyA.breakdown.ML_TRAINING.taskCount).toBe(1);
  });

  it("should return CSV format report when format=csv is queried", async () => {
    const resA = await ctx.app.inject({
      method: "GET",
      url: "/v2/carbon/report?format=csv",
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    expect(resA.statusCode).toBe(200);
    expect(resA.headers["content-type"]).toBe("text/csv");
    expect(resA.headers["content-disposition"]).toContain("attachment; filename=");

    const lines = resA.payload.trim().split("\n");
    expect(lines.length).toBe(3); // 1 header row + 2 data rows
    expect(lines[0]).toBe(
      "Task ID,Task Type,Region,Node ID,Carbon Intensity (gCO2eq/kWh),Duration (ms),Estimated gCO2eq,Estimated Watts,Was Deferred,Baseline gCO2eq,Carbon Saved gCO2eq,Recorded At"
    );

    // Verify row values
    expect(lines[1]).toContain("task-a1");
    expect(lines[1]).toContain("MODEL_INFERENCE");
    expect(lines[1]).toContain("TRUE"); // wasDeferred
    expect(lines[2]).toContain("task-a2");
    expect(lines[2]).toContain("ML_TRAINING");
    expect(lines[2]).toContain("FALSE"); // wasDeferred
  });
});
