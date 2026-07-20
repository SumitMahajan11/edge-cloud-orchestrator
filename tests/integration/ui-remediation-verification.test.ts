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
      await (prisma as any).workflow?.deleteMany({ where: { tenantId } });
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

  it("should verify Edit Policy (Row 7)", async () => {
    console.log(`\n=== ROW 7: EDIT POLICY ===`);
    const created = await prisma.schedulingPolicy.create({
      data: {
        name: "Initial Latency Guard",
        type: "LATENCY",
        config: { maxLatencyMs: 200 },
        isActive: false,
        tenantId,
      },
    });

    const policyBefore = await prisma.schedulingPolicy.findUnique({
      where: { id: created.id },
    });
    console.log(`[BEFORE DB QUERY] SELECT * FROM "scheduling_policies" WHERE id = '${created.id}'; -> Name: "${policyBefore.name}", Type: "${policyBefore.type}", Config: ${JSON.stringify(policyBefore.config)}`);

    const response = await context.app.inject({
      method: "PUT",
      url: `/v2/scheduling/policies/${created.id}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Tenant-ID": tenantId,
      },
      payload: {
        name: "Updated Latency Guard (Strict)",
        type: "LATENCY",
        config: { maxLatencyMs: 80 },
        isActive: false,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);

    const policyAfter = await prisma.schedulingPolicy.findUnique({
      where: { id: created.id },
    });
    console.log(`[AFTER DB QUERY]  SELECT * FROM "scheduling_policies" WHERE id = '${created.id}'; -> Name: "${policyAfter.name}", Type: "${policyAfter.type}", Config: ${JSON.stringify(policyAfter.config)}`);

    expect(policyAfter.name).toBe("Updated Latency Guard (Strict)");
    expect(policyAfter.config.maxLatencyMs).toBe(80);
  });

  it("should verify Delete Policy (Row 8)", async () => {
    console.log(`\n=== ROW 8: DELETE POLICY ===`);
    const policyToDelete = await prisma.schedulingPolicy.create({
      data: {
        name: "Temporary Cost Guardrail",
        type: "COST",
        config: { maxCostUSD: 0.10 },
        isActive: false,
        tenantId,
      },
    });

    const beforeCount = await prisma.schedulingPolicy.count({
      where: { id: policyToDelete.id },
    });
    console.log(`[BEFORE DB QUERY] SELECT COUNT(*) FROM "scheduling_policies" WHERE id = '${policyToDelete.id}'; -> Result: ${beforeCount}`);

    const response = await context.app.inject({
      method: "DELETE",
      url: `/v2/scheduling/policies/${policyToDelete.id}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Tenant-ID": tenantId,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(body.id).toBe(policyToDelete.id);

    const afterCount = await prisma.schedulingPolicy.count({
      where: { id: policyToDelete.id },
    });
    console.log(`[AFTER DB QUERY]  SELECT COUNT(*) FROM "scheduling_policies" WHERE id = '${policyToDelete.id}'; -> Result: ${afterCount}`);

    expect(afterCount).toBe(0);

    const activePolicy = await prisma.schedulingPolicy.findFirst({
      where: { tenantId, isActive: true },
    });

    if (activePolicy) {
      const activeDeleteResp = await context.app.inject({
        method: "DELETE",
        url: `/v2/scheduling/policies/${activePolicy.id}`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Tenant-ID": tenantId,
        },
      });
      expect(activeDeleteResp.statusCode).toBe(400);
      const activeDeleteBody = JSON.parse(activeDeleteResp.payload);
      console.log(`[VERIFIED ACTIVE BLOCK] DELETE on active policy returned HTTP 400: "${activeDeleteBody.error}"`);
    }
  });

  it("should verify Test Webhook (Row 10)", async () => {
    console.log(`\n=== ROW 10: TEST WEBHOOK ===`);
    const hook = await prisma.webhook.create({
      data: {
        name: "Test Target Endpoint",
        url: "https://api.example.com/test",
        events: JSON.stringify(["node.offline"]) as any,
        secret: "super-secret-key-1234-at-least-32-characters",
        tenantId,
      },
    });

    const beforeDeliveries = await prisma.webhookDelivery.count({
      where: { webhookId: hook.id },
    });
    console.log(`[BEFORE DB QUERY] SELECT COUNT(*) FROM "webhook_deliveries" WHERE "webhookId" = '${hook.id}'; -> Result: ${beforeDeliveries}`);

    const response = await context.app.inject({
      method: "POST",
      url: `/v2/webhooks/${hook.id}/test`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Tenant-ID": tenantId,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);

    const afterDeliveries = await prisma.webhookDelivery.count({
      where: { webhookId: hook.id },
    });
    console.log(`[AFTER DB QUERY]  SELECT COUNT(*) FROM "webhook_deliveries" WHERE "webhookId" = '${hook.id}'; -> Result: ${afterDeliveries}`);
    expect(afterDeliveries).toBe(beforeDeliveries + 1);

    const delivery = await prisma.webhookDelivery.findFirst({
      where: { webhookId: hook.id },
      orderBy: { createdAt: "desc" },
    });
    console.log(`[VERIFIED RECORD] Created Webhook Delivery ID: ${delivery.id}, Event: "${delivery.event}", Status: "${delivery.status}"`);
  });

  it("should verify Edit Webhook (Row 11)", async () => {
    console.log(`\n=== ROW 11: EDIT WEBHOOK ===`);
    const hook = await prisma.webhook.create({
      data: {
        name: "Original Slack Hook",
        url: "https://hooks.slack.com/services/original",
        events: JSON.stringify(["node.offline"]) as any,
        tenantId,
      },
    });

    console.log(`[BEFORE DB QUERY] SELECT * FROM "webhooks" WHERE id = '${hook.id}'; -> Name: "${hook.name}", URL: "${hook.url}"`);

    const response = await context.app.inject({
      method: "PATCH",
      url: `/v2/webhooks/${hook.id}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Tenant-ID": tenantId,
      },
      payload: {
        name: "Updated Slack Hook (Production)",
        url: "https://hooks.slack.com/services/updated",
      },
    });

    expect(response.statusCode).toBe(200);
    const updatedHook = await prisma.webhook.findUnique({
      where: { id: hook.id },
    });
    console.log(`[AFTER DB QUERY]  SELECT * FROM "webhooks" WHERE id = '${hook.id}'; -> Name: "${updatedHook.name}", URL: "${updatedHook.url}"`);

    expect(updatedHook.name).toBe("Updated Slack Hook (Production)");
    expect(updatedHook.url).toBe("https://hooks.slack.com/services/updated");
  });

  it("should verify Delete Webhook (Row 12)", async () => {
    console.log(`\n=== ROW 12: DELETE WEBHOOK ===`);
    const hookToDelete = await prisma.webhook.create({
      data: {
        name: "Temporary Webhook To Delete",
        url: "https://api.example.com/delete-me",
        events: JSON.stringify(["task.failed"]) as any,
        tenantId,
      },
    });

    const beforeCount = await prisma.webhook.count({
      where: { id: hookToDelete.id },
    });
    console.log(`[BEFORE DB QUERY] SELECT COUNT(*) FROM "webhooks" WHERE id = '${hookToDelete.id}'; -> Result: ${beforeCount}`);

    const response = await context.app.inject({
      method: "DELETE",
      url: `/v2/webhooks/${hookToDelete.id}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Tenant-ID": tenantId,
      },
    });

    expect(response.statusCode).toBe(200);
    const afterCount = await prisma.webhook.count({
      where: { id: hookToDelete.id },
    });
    console.log(`[AFTER DB QUERY]  SELECT COUNT(*) FROM "webhooks" WHERE id = '${hookToDelete.id}'; -> Result: ${afterCount}`);

    expect(afterCount).toBe(0);
  });

  it("should verify Create Workflow (Row 17)", async () => {
    console.log(`\n=== ROW 17: CREATE WORKFLOW ===`);
    const beforeCount = await prisma.workflow.count({
      where: { tenantId },
    });
    console.log(`[BEFORE DB QUERY] SELECT COUNT(*) FROM "workflows" WHERE "tenantId" = '${tenantId}'; -> Result: ${beforeCount}`);

    const response = await context.app.inject({
      method: "POST",
      url: "/v2/workflows",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Tenant-ID": tenantId,
      },
      payload: {
        name: "Data Ingestion DAG",
        version: "1.0.0",
        nodes: [
          {
            id: "node-1",
            name: "Ingest Sensor Data",
            type: "task",
            config: {},
            inputs: [],
            outputs: ["out-1"],
          },
        ],
        edges: [],
      },
    });

    expect([200, 201]).toContain(response.statusCode);
    const body = JSON.parse(response.payload);
    expect(body.id).toBeDefined();

    const afterCount = await prisma.workflow.count({
      where: { tenantId },
    });
    console.log(`[AFTER DB QUERY]  SELECT COUNT(*) FROM "workflows" WHERE "tenantId" = '${tenantId}'; -> Result: ${afterCount}`);

    expect(afterCount).toBe(beforeCount + 1);

    const createdWorkflow = await prisma.workflow.findUnique({
      where: { id: body.id },
    });
    console.log(`[VERIFIED RECORD] Created Workflow ID: ${createdWorkflow.id}, Name: "${createdWorkflow.name}", Version: "${createdWorkflow.version}"`);
  });

  it("should verify Edit Workflow (Row 19)", async () => {
    console.log(`\n=== ROW 19: EDIT WORKFLOW ===`);
    const testWfId = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";
    const wf = await prisma.workflow.create({
      data: {
        id: testWfId,
        name: "Initial Processing Pipeline",
        version: "1.0.0",
        definition: JSON.stringify({
          nodes: [
            { id: "step-1", name: "Initial Step", type: "task", config: {}, inputs: [], outputs: [] },
          ],
          edges: [],
        }) as any,
        tenantId,
      },
    });

    console.log(`[BEFORE DB QUERY] SELECT * FROM "workflows" WHERE id = '${wf.id}'; -> Name: "${wf.name}", Version: "${wf.version}"`);

    const response = await context.app.inject({
      method: "PUT",
      url: `/v2/workflows/${wf.id}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Tenant-ID": tenantId,
      },
      payload: {
        name: "Updated High-Throughput Pipeline",
        version: "1.1.0",
      },
    });

    expect(response.statusCode).toBe(200);
    const updatedWorkflow = await prisma.workflow.findUnique({
      where: { id: wf.id },
    });
    console.log(`[AFTER DB QUERY]  SELECT * FROM "workflows" WHERE id = '${wf.id}'; -> Name: "${updatedWorkflow.name}", Version: "${updatedWorkflow.version}"`);

    expect(updatedWorkflow.name).toBe("Updated High-Throughput Pipeline");
    expect(updatedWorkflow.version).toBe("1.1.0");
  });
});



