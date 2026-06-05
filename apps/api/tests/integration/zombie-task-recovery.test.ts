import axios from 'axios';
import Redis from 'ioredis';
import type { Logger } from 'pino';

import { TaskScheduler } from '../../src/services/task-scheduler';
import type { WebSocketManager } from '../../src/services/websocket-manager';
import type { PrismaClient } from '@prisma/client';

// Mock Redis
vi.mock('ioredis', () => {
  const zadd = vi.fn();
  const exec = vi.fn().mockResolvedValue([]);
  const pipeline = vi.fn().mockImplementation(() => ({
    zadd,
    exec,
  }));
  return {
    default: vi.fn().mockImplementation(() => ({
      set: vi.fn(),
      get: vi.fn(),
      setex: vi.fn(),
      eval: vi.fn(),
      zadd,
      zrem: vi.fn(),
      zrange: vi.fn(),
      zrevrange: vi.fn(),
      expire: vi.fn(),
      quit: vi.fn(),
      del: vi.fn(),
      pipeline,
    })),
    zadd,
    pipeline,
  };
});

// Mock axios
vi.mock('axios', () => {
  const post = vi.fn();
  const isAxiosError = vi.fn().mockReturnValue(false);
  return {
    default: {
      post,
      isAxiosError,
    },
    post,
    isAxiosError,
  };
});

// Mock LeaderElection
const mockLeaderElection = {
  start: vi.fn().mockResolvedValue(true),
  stop: vi.fn().mockResolvedValue(undefined),
  isCurrentlyLeader: vi.fn().mockReturnValue(true),
};

// Mock internal packages
vi.mock('@edgecloud/shared-kernel', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@edgecloud/shared-kernel')>();
  return {
    ...actual,
    LeaderElection: vi.fn().mockImplementation(() => mockLeaderElection),
    getTraceId: vi.fn().mockReturnValue('mock-trace-id'),
    getRequestId: vi.fn().mockReturnValue('mock-request-id'),
    tracer: {
      startActiveSpan: vi.fn().mockImplementation((_name, _options, callback) =>
        callback({
          setStatus: vi.fn(),
          recordException: vi.fn(),
          end: vi.fn(),
        }),
      ),
    },
  };
});

vi.mock('@edgecloud/observability', () => ({
  MetricsCollector: vi.fn().mockImplementation(() => ({
    increment: vi.fn(),
    gauge: vi.fn(),
    histogram: vi.fn(),
  })),
}));

vi.mock('@edgecloud/ml-scheduler', () => ({
  SchedulingPredictor: vi.fn().mockImplementation(() => ({
    setMetrics: vi.fn(),
    getTrainedStatus: vi.fn().mockReturnValue(true),
  })),
  MLScheduler: vi.fn().mockImplementation(() => ({
    checkHotSwap: vi.fn(),
    schedule: vi.fn(),
  })),
  ModelRegistry: vi.fn(),
  DriftDetector: vi.fn().mockImplementation(() => ({
    onDrift: vi.fn(),
  })),
  FeatureExtractor: vi.fn(),
  OutcomeCollector: vi.fn(),
  IncrementalUpdater: vi.fn(),
  GridCarbonClient: vi.fn(),
}));

vi.mock('@edgecloud/circuit-breaker', () => ({
  CircuitBreakerRegistry: vi.fn().mockImplementation(() => ({
    getOrCreate: vi.fn().mockReturnValue({
      execute: vi.fn().mockImplementation((fn) => fn()),
      getState: vi.fn().mockReturnValue('CLOSED'),
    }),
    get: vi.fn().mockReturnValue({
      getState: vi.fn().mockReturnValue('CLOSED'),
    }),
  })),
}));

describe('Zombie Task Recovery Integration', () => {
  let scheduler: TaskScheduler;
  let mockPrisma: any;
  let mockRedis: any;
  let mockWsManager: any;
  let mockLogger: any;

  beforeEach(() => {
    mockPrisma = {
      task: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'task-1', submittedAt: new Date(), ...data }),
          ),
        updateMany: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn(),
      },
      taskExecution: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      edgeNode: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      schedulingDecision: {
        upsert: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn((ops) => Promise.all(ops)),
    };

    mockRedis = new Redis();
    mockWsManager = {
      broadcast: vi.fn(),
    };
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    scheduler = new TaskScheduler(
      mockPrisma as unknown as PrismaClient,
      mockRedis as unknown as Redis,
      mockWsManager as unknown as WebSocketManager,
      mockLogger as unknown as Logger,
    );
  });

  describe('Atomic Assignment & Rollback', () => {
    it('should revert task to PENDING if dispatch fails', async () => {
      const task = {
        id: 'task-1',
        tenantId: 'tenant-1',
        status: 'PENDING',
        maxRetries: 3,
        priority: 'HIGH',
        submittedAt: new Date(),
        runtime: 'DOCKER',
        policy: 'LATENCY',
      };
      const node = { id: 'node-1', url: 'http://node-1' };
      const execution = { id: 'exec-1', attemptNumber: 1 };

      mockPrisma.taskExecution.findFirst.mockResolvedValue(execution);

      // Mock axios failure
      (axios.post as any).mockRejectedValueOnce(new Error('Network error'));
      (axios as any).isAxiosError.mockReturnValueOnce(true);

      // Invoke assignTask
      await (scheduler as any).assignTask(task, node);

      // Verify transaction 1: Atomic SCHEDULED update
      expect(mockPrisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1' },
          data: expect.objectContaining({
            status: 'SCHEDULED',
            nodeId: 'node-1',
          }),
        }),
      );

      // Verify rollback transaction
      expect(mockPrisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1' },
          data: expect.objectContaining({ status: 'PENDING', nodeId: null }),
        }),
      );

      // Verify TaskExecution marked as FAILED
      expect(mockPrisma.taskExecution.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'exec-1' },
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
    });
  });

  describe('Reconciliation Loop Zombie Recovery', () => {
    it('should recover tasks stuck in SCHEDULED for > 60s and reconcile node count', async () => {
      const now = Date.now();
      const zombieTask = {
        id: 'zombie-1',
        status: 'SCHEDULED',
        updatedAt: new Date(now - 65000), // 65s ago
        priority: 'MEDIUM',
        submittedAt: new Date(now - 120000),
        nodeId: 'node-1',
      };

      const node = { id: 'node-1', tasksRunning: 1 };

      mockPrisma.edgeNode.findMany.mockResolvedValue([node]);
      mockPrisma.task.findMany.mockResolvedValue([zombieTask]);

      // During reconciliation (Step 2), actualCountsMap will look up node-1,
      // so if groupBy returns empty array, it means actualCount is 0
      mockPrisma.task.groupBy.mockResolvedValue([]);

      // Run reconciliation
      await (scheduler as any).reconcileTaskCounts();

      // Verify zombie recovery (Step 1)
      expect(mockPrisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['zombie-1'] } },
          data: { status: 'PENDING', nodeId: null },
        }),
      );

      // Verify node count reconciled (Step 2)
      expect(mockPrisma.edgeNode.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'node-1' },
          data: { tasksRunning: 0 },
        }),
      );

      // Verify requeued in Redis
      expect(mockRedis.zadd).toHaveBeenCalledWith(
        'task:queue',
        expect.any(Number),
        'zombie-1',
      );
    });
  });
});
