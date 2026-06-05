/**
 * Webhook Idempotency Integration Tests
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestApp, teardownTestApp, type TestContext } from "./helpers";

describe("Webhook Idempotency Integration", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  }, 30000);

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  it("should prevent duplicate redelivery requests using idempotency", async () => {
    // 1. Create a webhook
    const webhookRes = await ctx.app.inject({
      method: "POST",
      url: "/v1/webhooks",
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
      },
      payload: {
        name: "Idempotency Test Webhook",
        url: "https://example.com/webhook",
        events: ["test.event"],
        enabled: true,
      },
    });
    expect(webhookRes.statusCode).toBe(201);
    const webhook = JSON.parse(webhookRes.payload);
    const webhookId = webhook.id;

    // 2. Create a dummy delivery record
    const delivery = await ctx.prisma.webhookDelivery.create({
      data: {
        webhookId,
        event: "test.event",
        payload: { test: true },
        status: "FAILED",
        tenantId: webhook.tenantId,
      },
    });

    // 3. First redeliver request - should succeed
    const res1 = await ctx.app.inject({
      method: "POST",
      url: `/v1/webhooks/${webhookId}/redeliver/${delivery.id}`,
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
      },
    });
    expect(res1.statusCode).toBe(200);
    const body1 = JSON.parse(res1.payload);
    expect(body1.success).toBe(true);

    // 4. Second redeliver request - should fail with 409 Conflict
    const res2 = await ctx.app.inject({
      method: "POST",
      url: `/v1/webhooks/${webhookId}/redeliver/${delivery.id}`,
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
      },
    });
    expect(res2.statusCode).toBe(409);
    const body2 = JSON.parse(res2.payload);
    expect(body2.error.code).toBe("CONFLICT");
    expect(body2.error.message).toContain("already in progress");
  });

  it("should prevent duplicate retry requests using idempotency", async () => {
    // 1. Create a webhook
    const webhookRes = await ctx.app.inject({
      method: "POST",
      url: "/v1/webhooks",
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
      },
      payload: {
        name: "Retry Idempotency Test",
        url: "https://example.com/webhook",
        events: ["test.event"],
        enabled: true,
      },
    });
    expect(webhookRes.statusCode).toBe(201);
    const webhook = JSON.parse(webhookRes.payload);
    const webhookId = webhook.id;

    // 2. Create a dummy delivery record
    const delivery = await ctx.prisma.webhookDelivery.create({
      data: {
        webhookId,
        event: "test.event",
        payload: { test: true },
        status: "FAILED",
        tenantId: webhook.tenantId,
      },
    });

    // 3. First retry request - should succeed
    const res1 = await ctx.app.inject({
      method: "POST",
      url: `/v1/webhooks/deliveries/${delivery.id}/retry`,
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
      },
    });
    expect(res1.statusCode).toBe(200);

    // 4. Second retry request - should fail with 409 Conflict
    const res2 = await ctx.app.inject({
      method: "POST",
      url: `/v1/webhooks/deliveries/${delivery.id}/retry`,
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
      },
    });
    expect(res2.statusCode).toBe(409);
    const body2 = JSON.parse(res2.payload);
    expect(body2.error.code).toBe("CONFLICT");
  });
});
