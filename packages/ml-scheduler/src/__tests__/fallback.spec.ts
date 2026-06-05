import { MLScheduler } from "../ml-scheduler";
import { EdgeNode, Task } from "@edgecloud/shared-kernel";

describe("MLScheduler Fallback Logic", () => {
  let scheduler: MLScheduler;

  beforeEach(() => {
    scheduler = new MLScheduler({} as any, {} as any, {} as any, {} as any);
  });

  const mockTask: Task = { id: "task-1" } as any;

  const createNode = (
    id: string,
    cpu: number,
    mem: number,
    status: any = "ONLINE",
  ): EdgeNode =>
    ({
      id,
      cpuUsage: cpu,
      memoryUsage: mem,
      status,
      latency: 100,
      tasksRunning: 0,
    }) as any;

  it("should pick the node with most available CPU when ML is unavailable", async () => {
    const node1 = createNode("node-high-usage", 90, 50);
    const node2 = createNode("node-low-usage", 10, 50);
    const node3 = createNode("node-med-usage", 50, 50);

    // Using private method access for unit test
    const decision = (scheduler as any).ruleBasedFallback(mockTask, [
      node1,
      node2,
      node3,
    ]);

    expect(decision.nodeId).toBe("node-low-usage");
  });

  it("should break ties by memory usage", async () => {
    const node1 = createNode("node-low-mem", 50, 10);
    const node2 = createNode("node-high-mem", 50, 90);

    const decision = (scheduler as any).ruleBasedFallback(mockTask, [
      node1,
      node2,
    ]);

    expect(decision.nodeId).toBe("node-low-mem");
  });

  it("should never pick a node with status=OFFLINE or status=DRAINING", async () => {
    const offlineNode = createNode("offline", 10, 10, "OFFLINE");
    const drainingNode = createNode("draining", 10, 10, "DRAINING");
    const busyOnlineNode = createNode("busy-online", 90, 90, "ONLINE");

    const decision = (scheduler as any).ruleBasedFallback(mockTask, [
      offlineNode,
      drainingNode,
      busyOnlineNode,
    ]);

    expect(decision.nodeId).toBe("busy-online");
  });

  it("should return null when zero eligible nodes exist", async () => {
    const offlineNode = createNode("offline", 10, 10, "OFFLINE");
    const drainingNode = createNode("draining", 10, 10, "DRAINING");

    const decision = (scheduler as any).ruleBasedFallback(mockTask, [
      offlineNode,
      drainingNode,
    ]);

    expect(decision).toBeNull();
  });
});
