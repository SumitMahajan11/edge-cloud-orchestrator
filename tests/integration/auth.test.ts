/**
 * Authentication Integration Tests
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestApp, teardownTestApp, type TestContext } from "./helpers";

describe("Authentication Integration", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  describe("POST /v1/auth/login", () => {
    it("should reject login with invalid credentials", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "invalid@example.com",
          password: "wrongpassword",
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty("error");
    });

    it("should return tokens on successful login", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "test-admin@edgecloud.io",
          password: "testpassword123",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty("accessToken");
      expect(body).toHaveProperty("refreshToken");
    });

    it("should reject invalid email format", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "not-an-email",
          password: "somepassword",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject empty password", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "test-admin@edgecloud.io",
          password: "",
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /v1/auth/refresh", () => {
    it("should refresh access token with valid refresh token", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/v1/auth/refresh",
        payload: {
          refreshToken: ctx.refreshToken,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty("accessToken");
    });

    it("should reject invalid refresh token", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/v1/auth/refresh",
        payload: {
          refreshToken: "invalid-token",
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /v1/auth/logout", () => {
    it("should logout successfully", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/v1/auth/logout",
        headers: {
          Authorization: `Bearer ${ctx.accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("Authorization", () => {
    it("should reject requests without token", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/tasks",
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject requests with invalid token", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/tasks",
        headers: {
          Authorization: "Bearer invalid-token",
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should accept requests with valid token", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/tasks",
        headers: {
          Authorization: `Bearer ${ctx.accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
