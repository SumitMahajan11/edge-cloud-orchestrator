import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestApp, teardownTestApp } from "./helpers";

describe("UI Remediation E2E Verification", () => {
  let context: any;
  let prisma: any;
  let tenantId: string;
  let accessToken: string;

  beforeAll(async () => {
    context = await setupTestApp();
    prisma = context.prisma;
    accessToken = context.accessToken;
    tenantId = context.tenantId;
  });

  afterAll(async () => {
    try {
      await prisma.schedulingPolicy.deleteMany({ where: { tenantId } });
    } catch {}
    try {
      await prisma.webhook.deleteMany({ where: { tenantId } });
    } catch {}
    try {
      await (prisma as any).nodeCertificate?.deleteMany({});
    } catch {}
    try {
      await prisma.edgeNode.deleteMany({ where: { tenantId } });
    } catch {}
    await teardownTestApp(context);
  });

  it("should verify Create Policy (Row 5)", async () => {
    // 1. Query before count
    const beforeCount = await prisma.schedulingPolicy.count({
      where: { tenantId },
    });
    console.log(`\n=== ROW 5: CREATE POLICY ===`);
    console.log(`[BEFORE DB QUERY] SELECT COUNT(*) FROM "scheduling_policies" WHERE "tenantId" = '${tenantId}'; -> Result: ${beforeCount}`);

    // 2. Call the endpoint
    const response = await context.app.inject({
      method: "POST",
      url: "/v2/scheduling/policies",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Tenant-ID": tenantId,
      },
      payload: {
        name: "Eco-Friendly SLA Guard",
        type: "CARBON",
        config: { minGreenPercent: 90 },
        isActive: true,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(body.policy.id).toBeDefined();

    // 3. Query after count
    const afterCount = await prisma.schedulingPolicy.count({
      where: { tenantId },
    });
    console.log(`[AFTER DB QUERY]  SELECT COUNT(*) FROM "scheduling_policies" WHERE "tenantId" = '${tenantId}'; -> Result: ${afterCount}`);
    
    // Assert row count increased by 1
    expect(afterCount).toBe(beforeCount + 1);

    const createdPolicy = await prisma.schedulingPolicy.findUnique({
      where: { id: body.policy.id },
    });
    console.log(`[VERIFIED RECORD] Created Policy ID: ${createdPolicy.id}, Name: "${createdPolicy.name}", Type: "${createdPolicy.type}", IsActive: ${createdPolicy.isActive}`);
  });

  it("should verify Register Webhook (Row 9)", async () => {
    // 1. Query before count
    const beforeCount = await prisma.webhook.count({
      where: { tenantId },
    });
    console.log(`\n=== ROW 9: REGISTER WEBHOOK ===`);
    console.log(`[BEFORE DB QUERY] SELECT COUNT(*) FROM "webhooks" WHERE "tenantId" = '${tenantId}'; -> Result: ${beforeCount}`);

    // 2. Call the endpoint
    const response = await context.app.inject({
      method: "POST",
      url: "/v2/webhooks",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Tenant-ID": tenantId,
      },
      payload: {
        name: "Alert Dispatcher",
        url: "https://api.example.com/alerts",
        events: ["node.offline", "task.failed"],
        secret: "super-secret-key-1234-at-least-32-characters",
      },
    });

    expect([200, 201]).toContain(response.statusCode);
    const body = JSON.parse(response.payload);
    expect(body.id).toBeDefined();

    // 3. Query after count
    const afterCount = await prisma.webhook.count({
      where: { tenantId },
    });
    console.log(`[AFTER DB QUERY]  SELECT COUNT(*) FROM "webhooks" WHERE "tenantId" = '${tenantId}'; -> Result: ${afterCount}`);

    // Assert row count increased by 1
    expect(afterCount).toBe(beforeCount + 1);

    const createdWebhook = await prisma.webhook.findUnique({
      where: { id: body.id },
    });
    console.log(`[VERIFIED RECORD] Created Webhook ID: ${createdWebhook.id}, Name: "${createdWebhook.name}", URL: "${createdWebhook.url}"`);
  });

  it("should verify Rotate Certificate (Row 4)", async () => {
    console.log(`\n=== ROW 4: ROTATE CERTIFICATE ===`);

    // 1. Pre-requisite: Create a node in DB
    const node = await prisma.edgeNode.create({
      data: {
        name: "Edge-Node-001",
        status: "ONLINE",
        location: "us-east-1",
        region: "us-east-1",
        ipAddress: "192.168.1.100",
        port: 8080,
        url: "http://192.168.1.100:8080",
        cpuCores: 4,
        memoryGB: 8,
        storageGB: 50,
        tenantId,
      },
    });

    // 2. Query certificates before rotation
    const certsBefore = await (prisma as any).nodeCertificate.findMany({
      where: { nodeId: node.id },
    });
    console.log(`[BEFORE DB QUERY] SELECT * FROM "node_certificates" WHERE "nodeId" = '${node.id}'; -> Result Count: ${certsBefore.length}`);

    // 3. Call the rotate certificate endpoint
    const response = await context.app.inject({
      method: "POST",
      url: `/v2/nodes/${node.id}/rotate-certificate`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Tenant-ID": tenantId,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(body.serialNumber).toBeDefined();
    expect(body.certificatePem).toBeDefined();

    // 4. Query node certificates after rotation
    const certsAfter = await (prisma as any).nodeCertificate.findMany({
      where: { nodeId: node.id },
    });

    console.log(`[AFTER DB QUERY]  SELECT * FROM "node_certificates" WHERE "nodeId" = '${node.id}'; -> Result Count: ${certsAfter.length}`);
    const activeCert = certsAfter.find((c: any) => c.isActive === true);
    console.log(`[VERIFIED RECORD] Active Certificate Serial: ${activeCert?.serialNumber}, ExpiresAt: ${activeCert?.expiresAt}`);

    // Assertions
    expect(certsAfter.length).toBeGreaterThan(certsBefore.length);
    expect(activeCert).toBeDefined();
    expect(activeCert.isActive).toBe(true);
  });
});
