import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestApp, teardownTestApp, TestContext } from "./helpers.js";
import { MetricCleanupJob } from "../../apps/api/src/jobs/metric-cleanup.js";
import { nodeMetricRowCount } from "../../apps/api/src/services/metrics-service.js";

describe("Metric Cleanup Job Integration Tests", () => {
  let ctx: TestContext;
  let job: MetricCleanupJob;
  const loggerMock = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  } as any;

  const tenantA = "tenant-cleanup-a";
  const tenantB = "tenant-cleanup-b";

  beforeAll(async () => {
    ctx = await setupTestApp();

    // Seed Tenants
    await ctx.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: "Tenant Cleanup A", slug: "tenant-cleanup-a", config: "{}" },
        { id: tenantB, name: "Tenant Cleanup B", slug: "tenant-cleanup-b", config: "{}" },
      ],
    });

    // Seed EdgeNodes
    await ctx.prisma.edgeNode.createMany({
      data: [
        {
          id: "dummy-node-1",
          name: "dummy-node-1",
          location: "Location A",
          region: "us-east-1",
          ipAddress: "10.0.0.1",
          port: 4001,
          url: "http://10.0.0.1:4001",
          cpuCores: 4,
          memoryGB: 16,
          storageGB: 100,
          tenantId: tenantA,
        },
        {
          id: "dummy-node-2",
          name: "dummy-node-2",
          location: "Location B",
          region: "us-east-2",
          ipAddress: "10.0.0.2",
          port: 4002,
          url: "http://10.0.0.2:4002",
          cpuCores: 8,
          memoryGB: 32,
          storageGB: 200,
          tenantId: tenantB,
        },
      ],
    });

    // Seed custom MetricRetentionPolicy for Tenant A (10 days)
    // Tenant B will fall back to default (30 days)
    await ctx.prisma.metricRetentionPolicy.create({
      data: {
        tenantId: tenantA,
        retentionDays: 10,
      },
    });

    job = new MetricCleanupJob(ctx.prisma as any, loggerMock, 24 * 60 * 60 * 1000, 30);
  });

  afterAll(async () => {
    // Clean up
    await ctx.prisma.metricRetentionPolicy.deleteMany();
    await ctx.prisma.nodeMetric.deleteMany();
    await ctx.prisma.edgeNode.deleteMany({
      where: {
        id: { in: ["dummy-node-1", "dummy-node-2"] }
      }
    });
    await ctx.prisma.tenant.deleteMany({
      where: {
        id: { in: [tenantA, tenantB] }
      }
    });
    await teardownTestApp(ctx);
  });

  it("should respect retention policies and delete expired metrics", async () => {
    const now = new Date();
    
    // Dates relative to now
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const twelveDaysAgo = new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000);
    const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
    const thirtyFiveDaysAgo = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);

    // Seed NodeMetrics
    await ctx.prisma.nodeMetric.createMany({
      data: [
        // Tenant A: 10 days retention
        {
          id: "metric-a-recent",
          tenantId: tenantA,
          nodeId: "dummy-node-1",
          cpuUsage: 0.1,
          memoryUsage: 0.2,
          storageUsage: 0.3,
          latency: 0,
          tasksRunning: 0,
          networkIn: 100,
          networkOut: 200,
          timestamp: fiveDaysAgo,
          createdAt: fiveDaysAgo,
        },
        {
          id: "metric-a-expired",
          tenantId: tenantA,
          nodeId: "dummy-node-1",
          cpuUsage: 0.5,
          memoryUsage: 0.6,
          storageUsage: 0.7,
          latency: 0,
          tasksRunning: 0,
          networkIn: 150,
          networkOut: 250,
          timestamp: twelveDaysAgo,
          createdAt: twelveDaysAgo,
        },
        // Tenant B: default 30 days retention
        {
          id: "metric-b-recent",
          tenantId: tenantB,
          nodeId: "dummy-node-2",
          cpuUsage: 0.15,
          memoryUsage: 0.25,
          storageUsage: 0.35,
          latency: 0,
          tasksRunning: 0,
          networkIn: 105,
          networkOut: 205,
          timestamp: fifteenDaysAgo,
          createdAt: fifteenDaysAgo,
        },
        {
          id: "metric-b-expired",
          tenantId: tenantB,
          nodeId: "dummy-node-2",
          cpuUsage: 0.55,
          memoryUsage: 0.65,
          storageUsage: 0.75,
          latency: 0,
          tasksRunning: 0,
          networkIn: 155,
          networkOut: 255,
          timestamp: thirtyFiveDaysAgo,
          createdAt: thirtyFiveDaysAgo,
        },
      ],
    });

    // Run the cleanup process
    await job.process();

    // Query metrics remaining
    const remainingMetrics = await ctx.prisma.nodeMetric.findMany({
      orderBy: { createdAt: "desc" },
    });

    // Expired metrics:
    // - metric-a-expired (12 days ago under 10 days retention) -> should be deleted
    // - metric-b-expired (35 days ago under 30 days retention) -> should be deleted
    // Remaining metrics:
    // - metric-a-recent (5 days ago under 10 days retention) -> should remain
    // - metric-b-recent (15 days ago under 30 days retention) -> should remain
    expect(remainingMetrics).toHaveLength(2);
    
    const remainingIds = remainingMetrics.map(m => m.id);
    expect(remainingIds).toContain("metric-a-recent");
    expect(remainingIds).toContain("metric-b-recent");
    expect(remainingIds).not.toContain("metric-a-expired");
    expect(remainingIds).not.toContain("metric-b-expired");
  });

  it("should process deletions in batches if there are many expired metrics", async () => {
    // Clear existing metrics first
    await ctx.prisma.nodeMetric.deleteMany();

    const now = new Date();
    const expiredDate = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000); // 15 days ago (expired for Tenant A)

    // Seed 5005 expired metrics for Tenant A
    const batchSize = 5005;
    const metricsData = Array.from({ length: batchSize }).map((_, index) => ({
      id: `metric-batch-${index}`,
      tenantId: tenantA,
      nodeId: "dummy-node-1",
      cpuUsage: 0.1,
      memoryUsage: 0.2,
      storageUsage: 0.3,
      latency: 0,
      tasksRunning: 0,
      networkIn: 100,
      networkOut: 200,
      timestamp: expiredDate,
      createdAt: expiredDate,
    }));

    // Insert in chunks of 1000 to prevent SQLite query limit/parameter errors during test seeding
    const chunkSize = 1000;
    for (let i = 0; i < metricsData.length; i += chunkSize) {
      const chunk = metricsData.slice(i, i + chunkSize);
      await ctx.prisma.nodeMetric.createMany({ data: chunk });
    }

    // Check we seeded them correctly
    const initialCount = await ctx.prisma.nodeMetric.count();
    expect(initialCount).toBe(batchSize);

    // Track Prometheus Gauge setter
    const gaugeSetSpy = vi.spyOn(nodeMetricRowCount, "set");

    // Run the cleanup process (should loop twice: once with 5000, then once with 5)
    await job.process();

    const remainingCount = await ctx.prisma.nodeMetric.count();
    expect(remainingCount).toBe(0);

    // Verify Prometheus Gauge was updated to 0
    expect(gaugeSetSpy).toHaveBeenCalledWith(0);
  });
});
