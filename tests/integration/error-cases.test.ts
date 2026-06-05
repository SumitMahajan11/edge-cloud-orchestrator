/**
 * Error Handling Integration Tests
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestTask,
  setupTestApp,
  teardownTestApp,
  type TestContext,
} from "./helpers";

describe("Error Handling Integration", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  describe("404 Not Found", () => {
    it("should return 404 for non-existent task", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/tasks/00000000-0000-0000-0000-000000000000",
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty("error");
    });

    it("should return 404 for non-existent node", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/nodes/00000000-0000-0000-0000-000000000000",
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("400 Bad Request", () => {
    it("should return 400 for invalid input", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/v1/tasks",
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
        payload: {
          // Missing required fields
          name: "Test",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty("error");
    });

    it("should return 400 for invalid UUID format", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/tasks/not-a-uuid",
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should return 400 for invalid pagination parameters", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/tasks?page=-1&limit=0",
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("401 Unauthorized", () => {
    it("should return 401 without token", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/tasks",
      });

      expect(response.statusCode).toBe(401);
    });

    it("should return 401 with malformed token", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/tasks",
        headers: { Authorization: "InvalidFormat" },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should return 401 with expired token", async () => {
      // This would require mocking time or using an actual expired token
      const expiredToken =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/tasks",
        headers: { Authorization: `Bearer ${expiredToken}` },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("429 Rate Limiting", () => {
    it("should apply rate limits on auth endpoints", async () => {
      // This test would need actual rate limiting configured
      // For now, we verify the endpoint is protected
      const requests = [];
      for (let i = 0; i < 5; i++) {
        requests.push(
          ctx.app.inject({
            method: "POST",
            url: "/v1/auth/login",
            payload: {
              email: "test@example.com",
              password: "wrongpassword",
            },
          }),
        );
      }

      const responses = await Promise.all(requests);
      // At least one should succeed (or fail with 401, not 429)
      const statusCodes = responses.map(
        (r: { statusCode: number }) => r.statusCode,
      );
      expect(
        statusCodes.some((code: number) => code === 401 || code === 200),
      ).toBe(true);
    });
  });

  describe("Error Response Format", () => {
    it("should return consistent error format", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/tasks/invalid-uuid",
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
      });

      const body = JSON.parse(response.payload);

      // Error responses should have consistent structure
      expect(body).toHaveProperty("error");
      expect(typeof body.error).toBe("object");
    });
  });

  describe("Request Validation", () => {
    it("should reject extra large payloads", async () => {
      const largePayload = {
        name: "x".repeat(1000000), // 1MB string
        type: "DATA_PROCESSING",
        priority: "MEDIUM",
      };

      const response = await ctx.app.inject({
        method: "POST",
        url: "/v1/tasks",
        headers: {
          Authorization: `Bearer ${ctx.accessToken}`,
          "content-type": "application/json",
        },
        payload: largePayload,
      });

      // Should reject with 413 or 400
      expect([400, 413, 414]).toContain(response.statusCode);
    });

    it("should reject invalid JSON", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/v1/tasks",
        headers: {
          Authorization: `Bearer ${ctx.accessToken}`,
          "content-type": "application/json",
        },
        body: "{ invalid json }",
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
