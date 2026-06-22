import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import axios from "axios";
import { SagaOrchestrator } from "../../packages/saga/src/index.js";
import { createTaskLifecycleSaga } from "../../apps/api/src/sagas/task-lifecycle-saga";
import { IdempotencyService } from "../../apps/api/src/services/idempotency-service";
import {
  createTestNode,
  createTestTask,
  setupTestApp,
  teardownTestApp,
  type TestContext,
  waitFor,
} from "./helpers.js";

vi.mock("axios");

describe("Saga Flow Integration", () => {
  let ctx: TestContext;
  let orchestrator: SagaOrchestrator;
  let idempotencyService: IdempotencyService;

  beforeAll(async () => {
    ctx = await setupTestApp();

    const redis = (ctx.app as any).redis;
    const logger = (ctx.app as any).log;

    idempotencyService = new IdempotencyService(ctx.prisma, redis, logger);

    if ((ctx.app as any).taskScheduler) {
      await (ctx.app as any).taskScheduler.stop();
    }

    orchestrator = new SagaOrchestrator(ctx.prisma, {}, redis);

    const saga = createTaskLifecycleSaga(
      ctx.prisma,
      logger,
      idempotencyService,
      redis,
    );
    orchestrator.registerSaga(saga);
  }, 60000);

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  it("should handle various failure and rollback scenarios sequentially", async () => {
    // SCENARIO 1: Assignment Fails
    {
      await ctx.prisma.taskExecution.deleteMany({});

      const node = await createTestNode(ctx, {
        ipAddress: "10.0.0.1",
        port: 4001,
        tasksRunning: 0,
      });
      await ctx.prisma.edgeNode.update({
        where: { id: node.id },
        data: { status: "ONLINE" },
      });
      const task = await createTestTask(ctx, {
        name: "Saga Failure Test 1",
        nodeId: node.id,
      });

      vi.mocked(axios.post).mockRejectedValueOnce({
        message: "Request failed with status code 500",
        response: { status: 500, data: { error: "Node busy" } },
      });

      const correlationId = `test-saga-1-${Date.now()}`;
      const sagaInstance = await orchestrator.startSaga(
        "TaskLifecycleSaga",
        correlationId,
        {
          taskId: task.id,
          taskName: task.name,
          taskType: task.type,
          tenantId: ctx.tenantId,
        },
        ctx.tenantId,
      );
      const internalSagaId = sagaInstance.id;

      // Wait for the Task status to be reverted to PENDING by compensation
      await waitFor(
        async () => {
          const updatedTask = await ctx.prisma.task.findUnique({
            where: { id: task.id },
          });
          const execution = await ctx.prisma.taskExecution.findFirst({
            where: { taskId: task.id },
            orderBy: { attemptNumber: "desc" },
          });
          const state = await orchestrator.getSagaStatus(internalSagaId);
          return (
            updatedTask?.status === "PENDING" &&
            execution?.status === "CANCELLED" &&
            state?.status === "FAILED"
          );
        },
        { timeout: 45000, interval: 1000 },
      );

      const updatedNode = await ctx.prisma.edgeNode.findUnique({
        where: { id: node.id },
      });
      expect(updatedNode?.tasksRunning).toBe(0);
    }

    // SCENARIO 2: Timeout
    {
      await ctx.prisma.taskExecution.deleteMany({});

      const node = await createTestNode(ctx, {
        ipAddress: "10.0.0.2",
        port: 4001,
      });
      await ctx.prisma.edgeNode.update({
        where: { id: node.id },
        data: { status: "ONLINE" },
      });
      const task = await createTestTask(ctx, {
        name: "Saga Timeout Test 2",
        nodeId: node.id,
      });

      vi.mocked(axios.post).mockImplementationOnce(
        () =>
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("timeout of 5000ms exceeded")),
              100,
            ),
          ),
      );

      const correlationId = `timeout-saga-2-${Date.now()}`;
      const sagaInstance = await orchestrator.startSaga(
        "TaskLifecycleSaga",
        correlationId,
        {
          taskId: task.id,
          taskName: task.name,
          taskType: task.type,
          tenantId: ctx.tenantId,
        },
        ctx.tenantId,
      );
      const internalSagaId = sagaInstance.id;

      await waitFor(
        async () => {
          const updatedTask = await ctx.prisma.task.findUnique({
            where: { id: task.id },
          });
          const state = await orchestrator.getSagaStatus(internalSagaId);
          return (
            updatedTask?.status === "PENDING" && state?.status === "FAILED"
          );
        },
        { timeout: 30000, interval: 1000 },
      );

      const updatedNode = await ctx.prisma.edgeNode.findUnique({
        where: { id: node.id },
      });
      expect(updatedNode?.tasksRunning).toBe(0);
    }
  }, 120000);
});
