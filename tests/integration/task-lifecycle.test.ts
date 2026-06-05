/**
 * Task Lifecycle Integration Tests
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestNode,
  createTestTask,
  setupTestApp,
  teardownTestApp,
  type TestContext,
} from "./helpers";

describe("Task Lifecycle Integration", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  describe("Task Creation", () => {
    it("should create a new task", async () => {
      const task = await createTestTask(ctx, {
        name: "Test Task Creation",
        type: "DATA_PROCESSING",
      });

      expect(task).toHaveProperty("id");
      expect(task.name).toBe("Test Task Creation");
      expect(task.status).toBe("PENDING");
    });

    it("should reject invalid task type", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/v1/tasks",
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
        payload: {
          name: "Invalid Task",
          type: "INVALID_TYPE",
          priority: "MEDIUM",
        },
      });

      console.log("STATUS:", response.statusCode);
      console.log("PAYLOAD:", response.payload);
      expect(response.statusCode).toBe(400);
    });

    it("should reject missing required fields", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/v1/tasks",
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
        payload: {
          priority: "MEDIUM",
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("Task Retrieval", () => {
    it("should get task by ID", async () => {
      const task = await createTestTask(ctx);

      const response = await ctx.app.inject({
        method: "GET",
        url: `/v1/tasks/${task.id}`,
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const retrieved = JSON.parse(response.payload);
      expect(retrieved.id).toBe(task.id);
    });

    it("should return 404 for non-existent task", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/tasks/00000000-0000-0000-0000-000000000000",
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("Task Listing", () => {
    it("should list tasks with pagination", async () => {
      // Create multiple tasks
      await createTestTask(ctx, { name: "Task 1" });
      await createTestTask(ctx, { name: "Task 2" });

      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/tasks?page=1&limit=10",
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty("data");
      expect(body).toHaveProperty("pagination");
      expect(Array.isArray(body.data)).toBe(true);
    });

    it("should filter by status", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/tasks?status=PENDING",
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should sort by allowed fields", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/tasks?sortBy=priority&sortOrder=desc",
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should reject invalid sortBy field", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/tasks?sortBy=invalid_field",
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("Task Cancellation", () => {
    it("should cancel a pending task", async () => {
      const task = await createTestTask(ctx);

      const response = await ctx.app.inject({
        method: "POST",
        url: `/v1/tasks/${task.id}/cancel`,
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const cancelled = JSON.parse(response.payload);
      expect(cancelled.status).toBe("CANCELLED");
    });

    it("should not cancel already completed task", async () => {
      const task = await createTestTask(ctx);

      // Manually set to completed
      await ctx.prisma.task.update({
        where: { id: task.id },
        data: { status: "COMPLETED" },
      });

      const response = await ctx.app.inject({
        method: "POST",
        url: `/v1/tasks/${task.id}/cancel`,
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("Task Retry", () => {
    it("should retry a failed task", async () => {
      const task = await createTestTask(ctx);

      // Manually set to failed
      await ctx.prisma.task.update({
        where: { id: task.id },
        data: { status: "FAILED" },
      });

      const response = await ctx.app.inject({
        method: "POST",
        url: `/v1/tasks/${task.id}/retry`,
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
      });

      expect(response.statusCode).toBe(201);
      const retried = JSON.parse(response.payload);
      expect(retried.status).toBe("PENDING");
    });

    it("should not retry a non-failed task", async () => {
      const task = await createTestTask(ctx);

      const response = await ctx.app.inject({
        method: "POST",
        url: `/v1/tasks/${task.id}/retry`,
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
