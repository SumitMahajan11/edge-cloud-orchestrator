import axios from "axios";
import Fastify from "fastify";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Set global timeouts and environment variables before imports
vi.setConfig({ hookTimeout: 120000, testTimeout: 120000 });

const SERVICE_TOKEN = "c".repeat(32);
const ENCRYPTION_KEY = "b".repeat(32);
const JWT_SECRET = "a".repeat(32);

process.env.DATABASE_URL =
  "postgresql://mock:mock@localhost:5432/mock?sslmode=require";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_SECRET = JWT_SECRET;
process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
process.env.SERVICE_TOKEN = SERVICE_TOKEN;
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "debug";
process.env.KAFKAJS_NO_PARTITIONER_WARNING = "1";
process.env.ALLOW_PRIVATE_IPS = "true";

// Shared in-memory state
const dbState = {
  edgeNodes: new Map(),
  tasks: new Map(),
  executions: new Map(),
  tenants: new Map(),
  users: new Map(),
  auditLogs: new Map(),
  metrics: new Map(),
  alerts: new Map(),
  alertRules: new Map(),
  webhooks: new Map(),
  webhookDeliveries: new Map(),
  schedulingDecisions: new Map(),
  certificateAuthorities: new Map(),
  nodeCertificates: new Map(),
  certificateRevocations: new Map(),
  bootstrapTokens: new Map(),
  schedulingPolicies: new Map(),
  nodeHealthScores: new Map(),
  carbonRecords: new Map(),
};

// Ports for tests
const API_PORT = 4010;
const TASK_SERVICE_PORT = 4011;
const AGENT_PORT = 4012;

// Shared state for mocks
const kafkaHandlers: Map<string, Function[]> = new Map();

// Mock jsonwebtoken
vi.mock("jsonwebtoken", () => ({
  default: {
    verify: vi.fn().mockImplementation((token) => {
      if (token === "admin-token") {
        return {
          id: "admin-id",
          email: "admin@example.com",
          role: "ADMIN",
          tenantId: "default",
        };
      }
      return require("jsonwebtoken").verify(token, "a".repeat(32));
    }),
    sign: vi.fn().mockReturnValue("mock-token"),
  },
}));

// Mock pg
vi.mock("pg", () => ({
  Pool: vi.fn().mockImplementation(() => ({
    query: async (text: string, params: any[]) => {
      if (text.includes("UPDATE tasks")) {
        const id = params[params.length - 1];
        const task = dbState.tasks.get(id);
        if (task) {
          if (text.includes("status = $1")) {
            task.status = params[0];
          }
          if (text.includes('"nodeId" =')) {
            const nodeId = params.find(
              (p) => typeof p === "string" && p.length > 30,
            );
            if (nodeId) {
              task.nodeId = nodeId;
            }
          }
        }
        return { rowCount: 1, rows: [task] };
      }
      if (text.includes("SELECT COUNT(*) FROM tasks")) {
        const status = params[0];
        const count = Array.from(dbState.tasks.values()).filter(
          (t) => t.status === status,
        ).length;
        return { rows: [{ count: count.toString() }] };
      }
      if (text.includes("SELECT * FROM tasks WHERE id =")) {
        const task = dbState.tasks.get(params[0]);
        return { rows: task ? [task] : [] };
      }
      if (text.includes("SELECT * FROM tasks")) {
        return { rows: Array.from(dbState.tasks.values()) };
      }
      return { rowCount: 0, rows: [] };
    },
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release: () => {},
    }),
    on: vi.fn(),
    end: async () => {},
  })),
}));

// Mock kafkajs
vi.mock("kafkajs", () => ({
  Kafka: vi.fn().mockImplementation(() => ({
    producer: vi.fn().mockReturnValue({
      connect: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockImplementation(async ({ topic, messages }) => {
        const handlers = kafkaHandlers.get(topic) || [];
        for (const msg of messages) {
          for (const handler of handlers) {
            handler({ topic, partition: 0, message: msg });
          }
        }
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }),
    consumer: vi.fn().mockReturnValue({
      connect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockImplementation(async ({ topic }) => {
        if (!kafkaHandlers.has(topic)) {
          kafkaHandlers.set(topic, []);
        }
      }),
      run: vi.fn().mockImplementation(async ({ eachMessage }) => {
        kafkaHandlers.forEach((handlers) => handlers.push(eachMessage));
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    }),
    admin: vi.fn().mockReturnValue({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      listTopics: vi.fn().mockResolvedValue([]),
      createTopics: vi.fn().mockResolvedValue(true),
    }),
  })),
}));

const resetDbState = () => {
  dbState.edgeNodes.clear();
  dbState.tasks.clear();
  dbState.executions.clear();
  dbState.tenants.clear();
  dbState.users.clear();
  dbState.auditLogs.clear();
  dbState.metrics.clear();
  dbState.alerts.clear();
  dbState.alertRules.clear();
  dbState.webhooks.clear();
  dbState.webhookDeliveries.clear();
  dbState.schedulingDecisions.clear();
  dbState.certificateAuthorities.clear();
  dbState.nodeCertificates.clear();
  dbState.certificateRevocations.clear();
  dbState.bootstrapTokens.clear();
  dbState.schedulingPolicies.clear();
  dbState.nodeHealthScores.clear();
  dbState.carbonRecords.clear();
  dbState.users.set("admin", {
    id: "admin",
    role: "ADMIN",
    tenantId: "default",
  });
  dbState.tenants.set("default", {
    id: "default",
    name: "Default Tenant",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
};

// Helper to create a mock model
const createMockModel = (stateKey: string) => ({
  create: async ({ data }: any) => {
    const id =
      data.id ||
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `id-${Math.random().toString(36).substr(2, 9)}`);
    const now = new Date();
    const item = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
      submittedAt: now,
      status:
        data.status ||
        (stateKey === "tasks"
          ? "PENDING"
          : stateKey === "edgeNodes"
            ? "ONLINE"
            : undefined),
      nodeId: data.nodeId || (stateKey === "tasks" ? null : undefined),
      priority: data.priority || (stateKey === "tasks" ? "MEDIUM" : undefined),
      isMaintenanceMode:
        data.isMaintenanceMode ??
        (stateKey === "edgeNodes" ? false : undefined),
      tasksRunning:
        data.tasksRunning ?? (stateKey === "edgeNodes" ? 0 : undefined),
      policy:
        data.policy || (stateKey === "tasks" ? "load-balanced" : "manual"),
      runtime: data.runtime || (stateKey === "tasks" ? "DOCKER" : undefined),
      affinity: data.affinity,
      traceId: data.traceId,
      tenantId: data.tenantId || "default",
    };
    (dbState as any)[stateKey].set(id, item);
    return item;
  },
  update: async ({ where, data }: any) => {
    const id = where.id || where.taskId;
    const item = (dbState as any)[stateKey].get(id);
    if (item) {
      Object.assign(item, data);
    }
    return item;
  },
  upsert: async ({ where, update, create }: any) => {
    const id = where.id || where.taskId;
    let item = (dbState as any)[stateKey].get(id);
    if (item) {
      Object.assign(item, update);
      return item;
    }
    const newItemId =
      id ||
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `id-${Math.random().toString(36).substr(2, 9)}`);
    item = {
      ...create,
      id: newItemId,
      createdAt: new Date(),
      updatedAt: new Date(),
      tenantId: create.tenantId || "default",
    };
    (dbState as any)[stateKey].set(newItemId, item);
    return item;
  },
  findUnique: async ({ where }: any) => {
    if (where.name) {
      return Array.from((dbState as any)[stateKey].values()).find(
        (n: any) => n.name === where.name,
      );
    }
    return (dbState as any)[stateKey].get(where.id || where.taskId);
  },
  findMany: async (args: any) => {
    let results = Array.from((dbState as any)[stateKey].values());
    if (args?.where) {
      results = results.filter((item: any) => {
        return Object.entries(args.where).every(([key, value]) => {
          if (value === null || value === undefined) {
            return true;
          }
          if (typeof value === "object" && value !== null) {
            if ("lt" in value) {
              return item[key] < (value as any).lt;
            }
            if ("lte" in value) {
              return item[key] <= (value as any).lte;
            }
            if ("gt" in value) {
              return item[key] > (value as any).gt;
            }
            if ("gte" in value) {
              return item[key] >= (value as any).gte;
            }
            if ("in" in value) {
              return (value as any).in.includes(item[key]);
            }
          }
          return item[key] === value;
        });
      });
    }
    return results;
  },
  findFirst: async (args: any) => {
    const results = await createMockModel(stateKey).findMany(args);
    return results[0] || null;
  },
  count: async () => (dbState as any)[stateKey].size,
  deleteMany: async () => ({ count: (dbState as any)[stateKey].size }),
  delete: async ({ where }: any) => {
    (dbState as any)[stateKey].delete(where.id || where.taskId);
    return { id: where.id || where.taskId };
  },
});

const mockPrismaInstance = {
  $connect: async () => {},
  $disconnect: async () => {},
  $extends: vi.fn().mockReturnThis(),
  $transaction: async (calls: any[]) => {
    const res = [];
    for (const c of calls) {
      res.push(await (typeof c === "function" ? c(mockPrismaInstance) : c));
    }
    return res;
  },
  $queryRaw: async () => [{ 1: 1 }],
  $executeRawUnsafe: async () => ({}),
  edgeNode: createMockModel("edgeNodes"),
  task: createMockModel("tasks"),
  taskExecution: createMockModel("executions"),
  user: createMockModel("users"),
  tenant: createMockModel("tenants"),
  sagaInstance: createMockModel("executions"),
  auditLog: createMockModel("auditLogs"),
  nodeMetric: createMockModel("metrics"),
  alert: createMockModel("alerts"),
  alertRule: createMockModel("alertRules"),
  webhook: createMockModel("webhooks"),
  webhookDelivery: createMockModel("webhookDeliveries"),
  schedulingDecision: createMockModel("schedulingDecisions"),
  certificateAuthority: createMockModel("certificateAuthorities"),
  nodeCertificate: createMockModel("nodeCertificates"),
  certificateRevocation: createMockModel("certificateRevocations"),
  bootstrapToken: createMockModel("bootstrapTokens"),
  schedulingPolicy: createMockModel("schedulingPolicies"),
  nodeHealthScore: createMockModel("nodeHealthScores"),
  carbonRecord: createMockModel("carbonRecords"),
};

// Mock dependencies at the top level
vi.mock("ioredis", () => ({
  default: require("ioredis-mock"),
  Redis: require("ioredis-mock"),
}));

vi.mock("kafkajs", () => {
  const mockProducer = {
    connect: async () => {},
    send: async () => {},
    disconnect: async () => {},
  };
  const mockConsumer = {
    connect: async () => {},
    subscribe: async () => {},
    run: async () => {},
    disconnect: async () => {},
  };
  return {
    Kafka: vi.fn().mockImplementation(() => ({
      producer: vi.fn().mockReturnValue(mockProducer),
      consumer: vi.fn().mockReturnValue(mockConsumer),
    })),
  };
});

vi.mock("@edgecloud/event-bus", () => ({
  EventBus: vi.fn().mockImplementation(() => ({
    connect: async () => {},
    disconnect: async () => {},
    publish: async () => {},
    subscribe: async () => {},
    createTopics: async () => {},
  })),
  DEFAULT_TOPIC_CONFIG: {},
  TOPICS: {
    TASK_EVENTS: "task-events",
    NODE_EVENTS: "node-events",
    TELEMETRY: "telemetry",
  },
}));

vi.mock("@edgecloud/saga", () => ({
  SagaOrchestrator: vi.fn().mockImplementation(() => ({
    start: async () => {},
    stop: async () => {},
    startSaga: async () => ({ id: "saga-1" }),
    recoverIncompleteSagas: async () => {},
    registerSaga: () => {},
    startRecovery: () => {},
    stopRecovery: () => {},
    startRecoveryJob: () => {},
    stopRecoveryJob: () => {},
  })),
}));

vi.mock("@edgecloud/shared-kernel", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    initTelemetry: vi.fn(),
    createLogger: vi.fn().mockReturnValue({
      info: vi.fn(),
      error: (m: any) => {
        const err = m.error || m;
        console.error(
          `[MOCK LOGGER ERROR] ${err.message || JSON.stringify(m)}`,
        );
        if (err.stack) {
          console.error(err.stack);
        }
      },
      warn: vi.fn(),
      debug: vi.fn(),
      fatal: (m: any) => {
        const err = m.error || m;
        console.error(
          `[MOCK LOGGER FATAL] ${err.message || JSON.stringify(m)}`,
        );
        if (err.stack) {
          console.error(err.stack);
        }
      },
      child: vi.fn().mockReturnThis(),
    }),
    SecretManagerFactory: {
      create: vi.fn().mockImplementation(() => ({
        getSecret: async (key: string) => process.env[key],
      })),
    },
    LeaderElection: vi.fn().mockImplementation(() => ({
      start: async () => {},
      stop: async () => {},
      isCurrentlyLeader: () => true,
    })),
    selectNode: vi.fn().mockImplementation((nodes) => nodes[0] || null),
    createAuthMiddleware: vi
      .fn()
      .mockImplementation(() => async (request: any) => {
        request.serviceAuth = true;
        request.user = { id: "service", role: "SERVICE" };
      }),
    requirePermission: vi.fn().mockReturnValue(async () => {}),
    requireRole: vi.fn().mockReturnValue(async () => {}),
    prismaForTenant: (client: any) => client,
  };
});

let api: any = {};
let taskService: any = {};

// Mock Prisma module
vi.mock("@prisma/client", () => {
  return {
    PrismaClient: vi.fn().mockImplementation(() => mockPrismaInstance),
    NodeStatus: { ONLINE: "ONLINE" },
    TaskStatus: { PENDING: "PENDING", COMPLETED: "COMPLETED" },
  };
});

// Helper to make axios clone-safe for Vitest
const safeAxios = async (config: any) => {
  try {
    return await axios(config);
  } catch (err: any) {
    const message = err.response
      ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    throw new Error(message);
  }
};

describe("Scheduling Flow E2E", () => {
  let mockAgent: any;

  beforeAll(async () => {
    try {
      console.log("Starting E2E Setup...");
      vi.spyOn(process, "exit").mockImplementation((code) => {
        console.error(`PROCESS.EXIT CALLED WITH CODE: ${code}`);
        return undefined as never;
      });

      // 1. Start Mock Agent
      mockAgent = Fastify();
      mockAgent.shouldFail = false;
      mockAgent.post("/run-task", async (req: any) => {
        const { taskId, runtime, affinity } = req.body;
        console.log(
          `[MockAgent] Received task: ${taskId}, runtime: ${runtime}, affinity: ${affinity}`,
        );

        mockAgent.lastReceivedTask = req.body;

        setTimeout(() => {
          if (mockAgent.shouldFail) {
            axios
              .post(
                `http://127.0.0.1:${TASK_SERVICE_PORT}/internal/tasks/${taskId}/fail`,
                { error: "Simulated failure", retryCount: 1, willRetry: true },
                { headers: { "X-Service-Token": SERVICE_TOKEN } },
              )
              .then(() =>
                console.log(`[MockAgent] Task ${taskId} reported failure`),
              )
              .catch((e) =>
                console.error(
                  `[MockAgent] Task ${taskId} report failure failed: ${e.message}`,
                ),
              );
          } else {
            axios
              .post(
                `http://127.0.0.1:${TASK_SERVICE_PORT}/internal/tasks/${taskId}/complete`,
                {
                  executionTimeMs: 100,
                  cost: 0.1,
                  output: { result: "success" },
                },
                { headers: { "X-Service-Token": SERVICE_TOKEN } },
              )
              .then(() =>
                console.log(`[MockAgent] Task ${taskId} reported complete`),
              )
              .catch((e) =>
                console.error(
                  `[MockAgent] Task ${taskId} report complete failed: ${e.message}`,
                ),
              );
          }
        }, 500);
        return { status: "accepted" };
      });
      await mockAgent.listen({ port: AGENT_PORT, host: "0.0.0.0" });
      console.log(`Mock Agent listening on port ${AGENT_PORT}`);

      // 2. Start Services
      const originalPort = process.env.PORT;

      console.log("Starting Task Service...");
      process.env.PORT = TASK_SERVICE_PORT.toString();
      taskService = await import("../../apps/task-service/src/index");
      await taskService.start();
      console.log("Task Service started.");

      console.log("Starting API Gateway...");
      process.env.PORT = API_PORT.toString();
      api = await import("../../apps/api/src/index");

      const decorateSafely = (name: string, value: any) => {
        if (api.app && !api.app.hasDecorator(name)) {
          api.app.decorate(name, value);
        }
      };
      decorateSafely("authenticate", async (request: any) => {
        request.user = { id: "admin", role: "ADMIN", tenantId: "default" };
      });
      decorateSafely("requireRole", () => async () => {});
      decorateSafely("authService", {});
      decorateSafely("rateLimitService", { checkLimit: async () => true });
      decorateSafely("prisma", mockPrismaInstance);

      await api.start();
      console.log(`API Gateway started on port ${API_PORT}.`);

      process.env.PORT = originalPort;

      await new Promise((r) => setTimeout(r, 3000));
      console.log("Setup Complete.");
    } catch (err: any) {
      console.error("Setup Error:", err.stack);
      throw new Error(`Setup failed: ${err.message}`);
    }
  }, 120000);

  beforeEach(() => {
    resetDbState();
    if (mockAgent) {
      mockAgent.lastReceivedTask = undefined;
      mockAgent.shouldFail = false;
    }
    if (api && api.app && api.app.taskScheduler) {
      api.app.taskScheduler.onlineNodesCache = null;
    }
  });

  afterAll(async () => {
    console.log("Shutting down services...");
    if (api.app) {
      await api.app.close();
    }
    if (taskService.app) {
      await taskService.app.close();
    }
    if (mockAgent) {
      await mockAgent.close();
    }
    console.log("Shutdown complete.");
  });

  it("HAPPY PATH", async () => {
    console.log("Step 1: Registering Node...");
    let nodeRes;
    for (let i = 0; i < 5; i++) {
      try {
        const nodeName = `node-${Math.random().toString(36).substr(2, 5)}`;
        nodeRes = await safeAxios({
          method: "post",
          url: `http://127.0.0.1:${API_PORT}/v1/nodes`,
          data: {
            name: nodeName,
            ipAddress: "127.0.0.1",
            port: AGENT_PORT,
            cpuCores: 4,
            memoryGB: 8,
            storageGB: 100,
            location: "us-east-1",
            region: "us-east-1",
          },
          headers: { Authorization: "Bearer admin-token" },
        });
        break;
      } catch (e: any) {
        if (i === 4) {
          throw e;
        }
        console.log(
          `Retrying node registration (${i + 1}/5)... error: ${e.message}`,
        );
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    const nodeId = nodeRes.data.id;
    console.log(`Node registered: ${nodeId}`);

    await safeAxios({
      method: "post",
      url: `http://127.0.0.1:${API_PORT}/v1/nodes/${nodeId}/heartbeat`,
      data: { cpuUsage: 10, memoryUsage: 20, tasksRunning: 0 },
      headers: { Authorization: "Bearer admin-token" },
    });
    dbState.edgeNodes.get(nodeId).status = "ONLINE";
    console.log("Node is ONLINE.");

    console.log("Step 2: Submitting Task...");
    const taskRes = await safeAxios({
      method: "post",
      url: `http://127.0.0.1:${API_PORT}/v1/tasks`,
      data: {
        name: "task-1",
        type: "DATA_PROCESSING",
        priority: "MEDIUM",
        specs: { cpuCores: 2, memoryGB: 4 },
        image: "edgecloud/worker:latest",
        runtime: "DOCKER",
      },
      headers: { Authorization: "Bearer admin-token" },
    });
    const taskId = taskRes.data.id;
    console.log(`Task submitted: ${taskId}`);

    console.log("Step 3: Polling for completion...");
    let completed = false;
    for (let i = 0; i < 30; i++) {
      const res = await safeAxios({
        method: "get",
        url: `http://127.0.0.1:${API_PORT}/v1/tasks/${taskId}`,
        headers: { Authorization: "Bearer admin-token" },
      });
      console.log(`Task status: ${res.data.status} (attempt ${i + 1}/30)`);
      if (
        res.data.status === "FAILED" ||
        res.data.status === "FAILED_PERMANENT"
      ) {
        console.error(`Task failed with error: ${res.data.error}`);
      }
      if (res.data.status === "COMPLETED") {
        completed = true;
        break;
      }

      // Manually trigger scheduling loop
      if (i % 2 === 0) {
        try {
          const scheduler = api.app.taskScheduler;
          if (scheduler) {
            console.log("[Scheduler] Triggering processQueue...");
            await scheduler.processQueue();
          }
        } catch (e: any) {
          console.warn(`[Scheduler] manual trigger failed: ${e.message}`);
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    expect(completed).toBe(true);
  }, 120000);

  it("AFFINITY AND RUNTIME", async () => {
    console.log("Step 1: Registering Node...");
    const nodeName = `node-affinity-${Math.random().toString(36).substr(2, 5)}`;
    const nodeRes = await safeAxios({
      method: "post",
      url: `http://127.0.0.1:${API_PORT}/v1/nodes`,
      data: {
        name: nodeName,
        ipAddress: "127.0.0.1",
        port: AGENT_PORT,
        cpuCores: 4,
        memoryGB: 8,
        storageGB: 100,
        location: "us-east-1",
        region: "us-east-1",
      },
      headers: { Authorization: "Bearer admin-token" },
    });
    const nodeId = nodeRes.data.id;

    await safeAxios({
      method: "post",
      url: `http://127.0.0.1:${API_PORT}/v1/nodes/${nodeId}/heartbeat`,
      data: { cpuUsage: 10, memoryUsage: 20, tasksRunning: 0 },
      headers: { Authorization: "Bearer admin-token" },
    });
    dbState.edgeNodes.get(nodeId).status = "ONLINE";

    console.log("Step 2: Submitting Task with Affinity and WASM runtime...");
    const taskRes = await safeAxios({
      method: "post",
      url: `http://127.0.0.1:${API_PORT}/v1/tasks`,
      data: {
        name: "wasm-task",
        type: "MODEL_INFERENCE",
        priority: "HIGH",
        runtime: "WASM",
        image: "http://example.com/main.wasm",
        affinity: "gpu=true",
        specs: { cpuCores: 2, memoryGB: 4 },
      },
      headers: { Authorization: "Bearer admin-token" },
    });
    const taskId = taskRes.data.id;
    expect(taskRes.data.runtime).toBe("WASM");
    expect(taskRes.data.affinity).toBe("gpu=true");

    console.log("Step 3: Triggering scheduler and verifying dispatch...");
    const scheduler = api.app.taskScheduler;
    await scheduler.processQueue();

    // Verify mock agent received the correct payload
    const lastTask = mockAgent.lastReceivedTask;
    expect(lastTask).toBeDefined();
    expect(lastTask.taskId).toBe(taskId);
    expect(lastTask.runtime).toBe("WASM");
    expect(lastTask.affinity).toBe("gpu=true");

    console.log("Affinity and Runtime verified in dispatch payload.");
  }, 60000);

  it("RETRY FLOW", async () => {
    console.log("Step 1: Registering Node...");
    const nodeRes = await safeAxios({
      method: "post",
      url: `http://127.0.0.1:${API_PORT}/v1/nodes`,
      data: {
        name: `retry-node-${Math.random().toString(36).substr(2, 5)}`,
        ipAddress: "127.0.0.1",
        port: AGENT_PORT,
        cpuCores: 4,
        memoryGB: 8,
        storageGB: 100,
        location: "us-east-1",
        region: "us-east-1",
      },
      headers: { Authorization: "Bearer admin-token" },
    });
    const nodeId = nodeRes.data.id;
    dbState.edgeNodes.get(nodeId).status = "ONLINE";

    console.log("Step 2: Submitting Task...");
    const taskRes = await safeAxios({
      method: "post",
      url: `http://127.0.0.1:${API_PORT}/v1/tasks`,
      data: {
        name: "retry-task",
        type: "DATA_PROCESSING",
        priority: "HIGH",
        specs: { cpuCores: 1, memoryGB: 1 },
        maxRetries: 5,
        image: "edgecloud/worker:latest",
        runtime: "DOCKER",
      },
      headers: { Authorization: "Bearer admin-token" },
    });
    const taskId = taskRes.data.id;

    console.log("Step 3: Triggering failure...");
    mockAgent.shouldFail = true;

    const scheduler = api.app.taskScheduler;
    await scheduler.processQueue();

    console.log("Step 4: Verifying retry status...");
    let retried = false;
    for (let i = 0; i < 15; i++) {
      const res = await safeAxios({
        method: "get",
        url: `http://127.0.0.1:${API_PORT}/v1/tasks/${taskId}`,
        headers: { Authorization: "Bearer admin-token" },
      });
      console.log(
        `Task status: ${res.data.status}, nodeId: ${res.data.nodeId}`,
      );

      // If it's PENDING again, it means it's ready for retry
      if (res.data.status === "PENDING") {
        retried = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    mockAgent.shouldFail = false;
    expect(retried).toBe(true);
  }, 30000);

  it("NO ELIGIBLE NODE", async () => {
    console.log("Step 1: Submitting Task with impossible requirements...");
    const taskRes = await safeAxios({
      method: "post",
      url: `http://127.0.0.1:${API_PORT}/v1/tasks`,
      data: {
        name: "impossible-task",
        type: "DATA_PROCESSING",
        priority: "LOW",
        specs: { cpuCores: 100, memoryGB: 100 },
        image: "edgecloud/worker:latest",
        runtime: "DOCKER",
      },
      headers: { Authorization: "Bearer admin-token" },
    });
    const taskId = taskRes.data.id;

    console.log("Step 2: Triggering scheduler...");
    const scheduler = api.app.taskScheduler;
    await scheduler.processQueue();

    console.log("Step 3: Verifying task remains PENDING...");
    const res = await safeAxios({
      method: "get",
      url: `http://127.0.0.1:${API_PORT}/v1/tasks/${taskId}`,
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(res.data.status).toBe("PENDING");
    expect(res.data.nodeId).toBeNull();
  }, 30000);

  it("ML FALLBACK", async () => {
    // 1. Setup ML Scheduler failure
    const scheduler = api.app.taskScheduler;
    const originalMlSchedule = scheduler.mlScheduler.schedule;
    scheduler.mlScheduler.schedule = vi
      .fn()
      .mockRejectedValue(new Error("ML Model Error"));

    // 2. Register node and submit task
    const nodeRes = await safeAxios({
      method: "post",
      url: `http://127.0.0.1:${API_PORT}/v1/nodes`,
      data: {
        name: "ml-fallback-node",
        ipAddress: "127.0.0.1",
        port: AGENT_PORT,
        cpuCores: 8,
        memoryGB: 16,
        storageGB: 100,
        location: "us-east-1",
        region: "us-east-1",
      },
      headers: { Authorization: "Bearer admin-token" },
    });
    dbState.edgeNodes.get(nodeRes.data.id).status = "ONLINE";

    const taskRes = await safeAxios({
      method: "post",
      url: `http://127.0.0.1:${API_PORT}/v1/tasks`,
      data: {
        name: "ml-task",
        type: "MODEL_INFERENCE",
        specs: { cpuCores: 2, memoryGB: 4 },
        image: "edgecloud/worker:latest",
        runtime: "DOCKER",
      },
      headers: { Authorization: "Bearer admin-token" },
    });

    // Explicitly set policy to ml-optimized in the mock DB and invalidate cache
    dbState.tasks.get(taskRes.data.id).policy = "ml-optimized";
    scheduler.onlineNodesCache = null;

    // 3. Trigger scheduling
    await scheduler.processQueue();

    // 4. Verify fallback to rule-based
    const taskStatus = await safeAxios({
      method: "get",
      url: `http://127.0.0.1:${API_PORT}/v1/tasks/${taskRes.data.id}`,
      headers: { Authorization: "Bearer admin-token" },
    });

    // It can be SCHEDULED, RUNNING or COMPLETED depending on timing
    expect(["SCHEDULED", "RUNNING", "COMPLETED"]).toContain(
      taskStatus.data.status,
    );
    expect(taskStatus.data.nodeId).toBeDefined();

    scheduler.mlScheduler.schedule = originalMlSchedule;
  }, 30000);

  it("WEBSOCKET PROPAGATION", async () => {
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`ws://127.0.0.1:${API_PORT}/ws?token=admin-token`);

    const events: any[] = [];
    ws.on("message", (data: any) => {
      const event = JSON.parse(data.toString());
      console.log(`[WS] Received event: ${event.type}`);
      events.push(event);
    });

    await new Promise((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
      setTimeout(() => reject(new Error("WS connection timeout")), 5000);
    });

    // Subscribe to all channels
    ws.send(
      JSON.stringify({ type: "subscribe", payload: { channels: ["*"] } }),
    );
    await new Promise((r) => setTimeout(r, 500));

    console.log("WS Connected and Subscribed. Submitting task...");
    await safeAxios({
      method: "post",
      url: `http://127.0.0.1:${API_PORT}/v1/tasks`,
      data: {
        name: "ws-task",
        type: "DATA_PROCESSING",
        specs: { cpuCores: 1, memoryGB: 1 },
        image: "edgecloud/worker:latest",
        runtime: "DOCKER",
      },
      headers: { Authorization: "Bearer admin-token" },
    });

    // Wait for events
    let received = false;
    for (let i = 0; i < 10; i++) {
      if (
        events.some(
          (e) => e.type === "task:created" || e.type === "task:status_changed",
        )
      ) {
        received = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    expect(received).toBe(true);
    ws.close();
  }, 30000);
});
