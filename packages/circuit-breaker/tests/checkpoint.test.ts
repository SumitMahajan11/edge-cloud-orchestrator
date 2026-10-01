import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AutomaticCheckpointing,
  CheckpointManager,
  InMemoryCheckpointStore,
} from "../src/checkpoint";

describe("CheckpointManager", () => {
  let manager: CheckpointManager;
  let store: InMemoryCheckpointStore;

  beforeEach(() => {
    store = new InMemoryCheckpointStore();
    manager = new CheckpointManager(store);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("save and load", () => {
    it("should save a checkpoint and emit checkpointCreated event", async () => {
      const createdSpy = vi.fn();
      manager.on("checkpointCreated", createdSpy);

      const cp = await manager.save("task-1", { step: 1, data: "test" });

      const checkpoint = await manager.load("task-1");

      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.state).toEqual({ step: 1, data: "test" });
      expect(createdSpy).toHaveBeenCalledWith({
        taskId: "task-1",
        checkpointId: cp.id,
      });
    });

    it("should return null for non-existent checkpoint", async () => {
      const checkpoint = await manager.load("non-existent");
      expect(checkpoint).toBeNull();
    });

    it("should save multiple checkpoints for same task and restore latest or by ID", async () => {
      const cp1 = await manager.save("task-1", { step: 1 });
      await manager.save("task-1", { step: 2 });

      const checkpoints = await manager.list("task-1");
      expect(checkpoints).toHaveLength(2);

      const restoredLatest = await manager.restoreFromCheckpoint("task-1");
      expect(restoredLatest).toEqual({ step: 2 });

      const restoredSpecific = await manager.restoreFromCheckpoint("task-1", cp1.id);
      expect(restoredSpecific).toEqual({ step: 1 });

      const restoredNull = await manager.restoreFromCheckpoint("non-existent-task");
      expect(restoredNull).toBeNull();
    });

    it("should increment sequence numbers", async () => {
      const cp1 = await manager.save("task-1", { step: 1 });
      const cp2 = await manager.save("task-1", { step: 2 });

      expect(cp1.metadata.sequenceNumber).toBe(1);
      expect(cp2.metadata.sequenceNumber).toBe(2);
    });
  });

  describe("list", () => {
    it("should list all checkpoints for a task", async () => {
      await manager.save("task-1", { step: 1 });
      await manager.save("task-1", { step: 2 });
      await manager.save("task-2", { step: 1 });

      const checkpoints1 = await manager.list("task-1");
      const checkpoints2 = await manager.list("task-2");

      expect(checkpoints1).toHaveLength(2);
      expect(checkpoints2).toHaveLength(1);
    });

    it("should return empty array for task with no checkpoints", async () => {
      const checkpoints = await manager.list("no-checkpoints");
      expect(checkpoints).toEqual([]);
    });
  });

  describe("delete", () => {
    it("should delete a specific checkpoint", async () => {
      await manager.save("task-1", { step: 1 });
      const cp2 = await manager.save("task-1", { step: 2 });

      await manager.delete("task-1", cp2.id);

      const checkpoints = await manager.list("task-1");
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0].state).toEqual({ step: 1 });
    });

    it("should delete all checkpoints for a task", async () => {
      await manager.save("task-1", { step: 1 });
      await manager.save("task-1", { step: 2 });

      await manager.delete("task-1");

      const checkpoints = await manager.list("task-1");
      expect(checkpoints).toHaveLength(0);
    });
  });

  describe("getLatest", () => {
    it("should return the most recent checkpoint", async () => {
      await manager.save("task-1", { step: 1 });
      await manager.save("task-1", { step: 2 });
      await manager.save("task-1", { step: 3 });

      const latest = await manager.getLatest("task-1");

      expect(latest?.state).toEqual({ step: 3 });
    });

    it("should return null if no checkpoints exist", async () => {
      const latest = await manager.getLatest("no-checkpoints");

      expect(latest).toBeNull();
    });
  });

  describe("withCheckpoint Execution Wrapper", () => {
    it("should restore state before executing and save state on success", async () => {
      let taskState = { count: 10 };
      const onRestore = vi.fn().mockImplementation((state) => {
        taskState = { ...state };
      });

      // Save initial checkpoint
      await manager.save("batch-job", { count: 5 });

      const result = await manager.withCheckpoint(
        "batch-job",
        async () => {
          taskState.count += 1;
          return "done";
        },
        () => taskState,
        onRestore,
      );

      expect(result).toBe("done");
      expect(onRestore).toHaveBeenCalledWith({ count: 5 });
      expect(taskState.count).toBe(6);

      const latest = await manager.getLatest("batch-job");
      expect(latest?.state).toEqual({ count: 6 });
    });

    it("should save checkpoint on failure and propagate error", async () => {
      let taskState = { step: "started" };

      await expect(
        manager.withCheckpoint(
          "failing-job",
          async () => {
            taskState.step = "crashed";
            throw new Error("Job execution failed");
          },
          () => taskState,
        ),
      ).rejects.toThrow("Job execution failed");

      const latest = await manager.getLatest("failing-job");
      expect(latest?.state).toEqual({ step: "crashed" });
    });
  });
});

describe("InMemoryCheckpointStore", () => {
  let store: InMemoryCheckpointStore;

  beforeEach(() => {
    store = new InMemoryCheckpointStore();
  });

  it("should persist checkpoints in memory", async () => {
    const checkpoint = {
      id: "cp-1",
      taskId: "task-1",
      state: { data: "test" },
      metadata: {
        createdAt: new Date(),
        sequenceNumber: 1,
        version: "1.0",
      },
    };

    await store.save(checkpoint);
    const loaded = await store.load("task-1");

    expect(loaded).toEqual(checkpoint);
  });

  it("should load specific checkpoint by id", async () => {
    await store.save({
      id: "cp-1",
      taskId: "task-1",
      state: { step: 1 },
      metadata: { createdAt: new Date(), sequenceNumber: 1, version: "1.0" },
    });
    await store.save({
      id: "cp-2",
      taskId: "task-1",
      state: { step: 2 },
      metadata: { createdAt: new Date(), sequenceNumber: 2, version: "1.0" },
    });

    const loaded = await store.load("task-1", "cp-2");

    expect(loaded?.state).toEqual({ step: 2 });
  });
});

describe("AutomaticCheckpointing", () => {
  let manager: CheckpointManager;
  let auto: AutomaticCheckpointing;

  beforeEach(() => {
    manager = new CheckpointManager();
    auto = new AutomaticCheckpointing(manager);
    vi.useFakeTimers();
  });

  afterEach(() => {
    auto.stopAll();
    vi.useRealTimers();
  });

  it("should periodically create checkpoints and emit autoCheckpoint", async () => {
    let state = { processed: 0 };
    const autoSpy = vi.fn();
    auto.on("autoCheckpoint", autoSpy);

    auto.start("stream-task", () => state, 500);

    state.processed = 50;
    await vi.advanceTimersByTimeAsync(500);

    expect(autoSpy).toHaveBeenCalledTimes(1);
    let latest = await manager.getLatest("stream-task");
    expect(latest?.state).toEqual({ processed: 50 });

    state.processed = 100;
    await vi.advanceTimersByTimeAsync(500);
    expect(autoSpy).toHaveBeenCalledTimes(2);
    latest = await manager.getLatest("stream-task");
    expect(latest?.state).toEqual({ processed: 100 });

    auto.stop("stream-task");
    await vi.advanceTimersByTimeAsync(1000);
    expect(autoSpy).toHaveBeenCalledTimes(2);
  });

  it("should emit autoCheckpointError on exception in getState", async () => {
    const errorSpy = vi.fn();
    auto.on("autoCheckpointError", errorSpy);

    auto.start("faulty-task", () => {
      throw new Error("Serialization failure");
    }, 200);

    await vi.advanceTimersByTimeAsync(200);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "faulty-task", error: expect.any(Error) }),
    );
  });
});
