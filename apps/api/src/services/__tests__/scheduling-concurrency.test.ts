// using globals for vitest API

import { TaskScheduler } from '../task-scheduler';

vi.mock('@edgecloud/shared-kernel', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@edgecloud/shared-kernel')>();
  return {
    ...actual,
    LeaderElection: vi.fn().mockImplementation(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      isCurrentlyLeader: vi.fn().mockReturnValue(true),
    })),
    selectNode: vi.fn().mockImplementation((nodes) => nodes[0] || null),
    tracer: {
      startActiveSpan: vi.fn().mockImplementation((_name, arg1, arg2) => {
        const cb = typeof arg1 === 'function' ? arg1 : arg2;
        return cb({
          end: vi.fn(),
          setStatus: vi.fn(),
          recordException: vi.fn(),
          setAttribute: vi.fn(),
        });
      }),
    },
    getRequestId: vi.fn().mockReturnValue('req-1'),
    getTraceId: vi.fn().mockReturnValue('trace-1'),
  };
});

// Mock ml-scheduler
vi.mock('@edgecloud/ml-scheduler', () => ({
  SchedulingPredictor: vi.fn().mockImplementation(() => ({
    setMetrics: vi.fn(),
    getTrainedStatus: vi.fn().mockReturnValue(true),
  })),
  MLScheduler: vi.fn().mockImplementation(() => ({
    checkHotSwap: vi.fn(),
    schedule: vi.fn().mockImplementation((_task, nodes) => {
      const node = nodes[0] || null;
      return node
        ? {
            decision: {
              nodeId: node.id,
              score: 1.0,
            },
            explanation: {
              top_features: [],
            },
            candidateNodes: [],
            modelVersion: 'v1',
            fallbackUsed: false,
          }
        : null;
    }),
  })),
  ModelRegistry: vi.fn(),
  DriftDetector: vi.fn().mockImplementation(() => ({
    onDrift: vi.fn(),
  })),
  FeatureExtractor: vi.fn(),
  OutcomeCollector: vi.fn(),
  IncrementalUpdater: vi.fn(),
  GridCarbonClient: vi.fn().mockImplementation(() => ({
    getCarbonIntensity: vi.fn().mockResolvedValue(250),
    mapRegionToZone: vi.fn().mockReturnValue('US-NE'),
  })),
}));

// Mock observability
vi.mock('@edgecloud/observability', () => ({
  MetricsCollector: vi.fn().mockImplementation(() => ({
    recordTaskCreated: vi.fn(),
  })),
}));

// Mock withSpan from tracing
vi.mock('../../lib/tracing.js', () => ({
  withSpan: vi.fn().mockImplementation(async (_name, fn) => {
    return fn({
      end: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      setAttribute: vi.fn(),
    });
  }),
}));

// Mock config
vi.mock('../../config/env', () => ({
  env: {
    FORCE_MOCK_DB: true,
    LOG_LEVEL: 'info',
    NODE_ENV: 'test',
    LOG_FORMAT: 'json',
  },
}));

describe('TaskScheduler Race Condition (RACE-01)', () => {
  let scheduler: TaskScheduler;
  let mockPrisma: any;
  let mockRedis: any;
  let mockWsManager: any;
  let mockLogger: any;
  let mockRedlock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma = {
      edgeNode: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      task: {
        findUnique: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
        findMany: vi.fn(),
      },
      taskExecution: {
        findFirst: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'exec-1' }),
        update: vi.fn(),
      },
      nodeHealthScore: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      schedulingDecision: {
        upsert: vi.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: vi.fn(),
      },
      schedulingPolicy: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn().mockResolvedValue([]),
    };

    mockRedis = {
      zadd: vi.fn(),
      zrem: vi.fn(),
      zcard: vi.fn().mockResolvedValue(1),
      zrevrange: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      setex: vi.fn(),
      del: vi.fn(),
      expire: vi.fn(),
    };

    mockWsManager = {
      broadcast: vi.fn().mockResolvedValue(undefined),
    };
    mockLogger = {
      info: vi.fn((...args) => console.log('[INFO]', ...args)),
      warn: vi.fn((...args) => console.log('[WARN]', ...args)),
      error: vi.fn((...args) => console.log('[ERROR]', ...args)),
      debug: vi.fn((...args) => console.log('[DEBUG]', ...args)),
    };

    scheduler = new TaskScheduler(
      mockPrisma,
      mockRedis,
      mockWsManager,
      mockLogger,
    );

    // Mock isCircuitOpen to prevent Redis/Registry dependencies
    (scheduler as any).isCircuitOpen = vi.fn().mockResolvedValue(false);

    // Mock redlock instance on the scheduler
    mockRedlock = {
      acquire: vi.fn(),
    };
    (scheduler as any).redlock = mockRedlock;
  });

  it('should prevent oversubscription by checking capacity inside the lock', async () => {
    const task = { id: 'task-1', tenantId: 't1', policy: 'default' } as any;
    const node = {
      id: 'node-1',
      url: 'http://node-1',
      tasksRunning: 9,
      status: 'ONLINE',
      isMaintenanceMode: false,
    };

    // 1. First call to findMany (eligible nodes)
    mockPrisma.edgeNode.findMany.mockResolvedValue([node]);

    // 2. redlock.acquire mock
    const mockLock = { release: vi.fn().mockResolvedValue(undefined) };
    mockRedlock.acquire.mockResolvedValue(mockLock);

    // 3. INSIDE THE LOCK: Prisma findUnique returns node with capacity (9/10)
    mockPrisma.edgeNode.findUnique.mockResolvedValue(node);

    const result = await (scheduler as any).scoreAndAssignWithLock(task);

    expect(result).toBe(true);
    expect(mockRedlock.acquire).toHaveBeenCalledWith(
      ['lock:node:assignment:node-1'],
      2000,
    );
    expect(mockPrisma.edgeNode.findUnique).toHaveBeenCalledWith({
      where: { id: 'node-1' },
      select: {
        tasksRunning: true,
        status: true,
        isMaintenanceMode: true,
        maxTasks: true,
      },
    });
    expect(mockLock.release).toHaveBeenCalled();
  });

  it('should skip node if capacity is reached while waiting for lock', async () => {
    const task = { id: 'task-1', tenantId: 't1', policy: 'default' } as any;
    const node = {
      id: 'node-1',
      url: 'http://node-1',
      tasksRunning: 9,
      status: 'ONLINE',
      isMaintenanceMode: false,
    };

    mockPrisma.edgeNode.findMany.mockResolvedValue([node]);

    const mockLock = { release: vi.fn().mockResolvedValue(undefined) };
    mockRedlock.acquire.mockResolvedValue(mockLock);

    // INSIDE THE LOCK: Node now has 10 tasks (oversubscribed by another pod)
    mockPrisma.edgeNode.findUnique.mockResolvedValue({
      ...node,
      tasksRunning: 10,
    });

    const result = await (scheduler as any).scoreAndAssignWithLock(task);

    expect(result).toBe(false);
    expect(mockLock.release).toHaveBeenCalled(); // Should still release
  });

  it('should skip node if lock cannot be acquired', async () => {
    const task = { id: 'task-1', tenantId: 't1', policy: 'default' } as any;
    const node = {
      id: 'node-1',
      url: 'http://node-1',
      tasksRunning: 9,
      status: 'ONLINE',
      isMaintenanceMode: false,
    };

    mockPrisma.edgeNode.findMany.mockResolvedValue([node]);

    // Lock acquisition fails (already held by another pod)
    mockRedlock.acquire.mockRejectedValue(new Error('Lock busy'));

    const result = await (scheduler as any).scoreAndAssignWithLock(task);

    expect(result).toBe(false);
    expect(mockPrisma.edgeNode.findUnique).not.toHaveBeenCalled(); // Never entered lock
  });

  it('should broadcast scheduler:decision when a task is successfully assigned', async () => {
    const task = {
      id: 'task-123',
      tenantId: 't1',
      policy: 'ml-optimized',
    } as any;
    const node = {
      id: 'node-123',
      url: 'http://127.0.0.1:4001',
      tasksRunning: 5,
      status: 'ONLINE',
      isMaintenanceMode: false,
      costPerHour: 0.15,
      carbonIntensity: 250,
      region: 'us-east',
    };

    mockPrisma.edgeNode.findMany.mockResolvedValue([node]);
    const mockLock = { release: vi.fn().mockResolvedValue(undefined) };
    mockRedlock.acquire.mockResolvedValue(mockLock);
    mockPrisma.edgeNode.findUnique.mockResolvedValue(node);

    const result = await (scheduler as any).scoreAndAssignWithLock(task);

    expect(result).toBe(true);
    expect(mockWsManager.broadcast).toHaveBeenCalledWith(
      'scheduler:decision',
      expect.objectContaining({
        taskId: 'task-123',
        selectedNodeId: 'node-123',
        mlScore: 1.0,
        usedML: true,
        latencyMs: expect.any(Number),
        carbonIntensity: 250,
        costUsd: 0.15,
      }),
    );
  });
});
