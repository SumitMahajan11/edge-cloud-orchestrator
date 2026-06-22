import type { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import type { Logger } from 'pino';

import { TaskScheduler } from '../task-scheduler';
import type { WebSocketManager } from '../websocket-manager';

// Mock Redis
vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
      eval: vi.fn(),
      zadd: vi.fn(),
      zrem: vi.fn(),
      zrange: vi.fn(),
      zrevrange: vi.fn(),
      expire: vi.fn(),
      quit: vi.fn(),
    })),
  };
});

// Mock axios
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
  AxiosError: class AxiosError extends Error {},
}));

// Mock LeaderElection
const mockLeaderElection = {
  start: vi.fn().mockResolvedValue(true),
  stop: vi.fn().mockResolvedValue(undefined),
  isCurrentlyLeader: vi.fn().mockReturnValue(true),
};

vi.mock('@edgecloud/shared-kernel', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@edgecloud/shared-kernel')>();
  return {
    ...actual,
    LeaderElection: vi.fn().mockImplementation(() => mockLeaderElection),
  };
});

describe('TaskScheduler', () => {
  let scheduler: TaskScheduler;
  let mockPrisma: Partial<PrismaClient>;
  let mockRedis: Redis;
  let mockWsManager: Partial<WebSocketManager>;
  let mockLogger: Logger;

  beforeEach(() => {
    mockPrisma = {
      task: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      } as unknown as PrismaClient['task'],
      edgeNode: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      } as unknown as PrismaClient['edgeNode'],
      schedulingDecision: {
        findUnique: vi.fn(),
      } as any,
      schedulingOutcome: {
        create: vi.fn(),
      } as any,
      schedulingPolicy: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
      } as any,
      nodeHealthScore: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      } as any,
      carbonRecord: {
        create: vi.fn(),
      } as any,
    } as Partial<PrismaClient>;

    mockRedis = new Redis();
    mockWsManager = {
      broadcast: vi.fn(),
      broadcastToUser: vi.fn(),
    };
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    scheduler = new TaskScheduler(
      mockPrisma as PrismaClient,
      mockRedis,
      mockWsManager as WebSocketManager,
      mockLogger,
    );
  });

  afterEach(async () => {
    await scheduler.stop();
    vi.clearAllMocks();
  });

  describe('Leader Election', () => {
    it('should attempt to become leader on start', async () => {
      await scheduler.start();

      expect(mockLeaderElection.start).toHaveBeenCalledWith(
        expect.stringContaining('scheduler-'),
        expect.any(Number),
      );
    });

    it('should handle leader election failure gracefully', async () => {
      mockLeaderElection.start.mockResolvedValueOnce(false);
      mockLeaderElection.isCurrentlyLeader.mockReturnValue(false);

      await scheduler.start();

      expect(scheduler.isCurrentlyLeader()).toBe(false);
    });

    it('should report leader status correctly', async () => {
      mockLeaderElection.isCurrentlyLeader.mockReturnValue(true);

      await scheduler.start();

      expect(scheduler.isCurrentlyLeader()).toBe(true);
    });
  });

  describe('Task Queue Operations', () => {
    it('should enqueue task with priority score', async () => {
      const task = {
        id: 'task-1',
        priority: 'HIGH',
        submittedAt: new Date(),
      } as any;

      await scheduler.enqueue(task);

      expect(mockRedis.zadd).toHaveBeenCalledWith(
        'task:queue',
        expect.any(Number),
        'task-1',
      );
      expect(mockRedis.expire).toHaveBeenCalledWith('task:queue', 86400);
    });

    it('should dequeue task from queue', async () => {
      await scheduler.dequeue('task-1');

      expect(mockRedis.zrem).toHaveBeenCalledWith('task:queue', 'task-1');
    });

    it('should calculate priority score correctly', async () => {
      const now = Date.now();
      const task = {
        id: 'task-1',
        priority: 'CRITICAL',
        submittedAt: new Date(now - 60000), // 1 minute old
      } as any;

      await scheduler.enqueue(task);

      // CRITICAL = 100, plus ~1 point for age = ~101
      const callArgs = vi.mocked(mockRedis.zadd).mock.calls[0] as any[];
      expect(callArgs[1]).toBeGreaterThan(100);
      expect(callArgs[1]).toBeLessThanOrEqual(110);
    });
  });

  describe('Scheduler State', () => {
    it('should track instance ID', async () => {
      await scheduler.start();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: expect.stringContaining('scheduler-'),
        }),
        'Task scheduler started',
      );
    });
  });

  describe('Carbon-Aware Deferral (carbonShiftSchedule)', () => {
    it('should not defer task if isDeferrable is false', async () => {
      const task = {
        id: 'task-non-defer',
        isDeferrable: false,
        maxDelayMinutes: 60,
        submittedAt: new Date(),
      };

      const result = await scheduler['carbonShiftSchedule'](task);
      expect(result).toBe(false);
    });

    it('should defer task to a low-carbon window if a lower carbon intensity window is forecasted', async () => {
      const task = {
        id: 'task-defer',
        isDeferrable: true,
        maxDelayMinutes: 60,
        submittedAt: new Date(),
      };

      // Mock database returning nodes in region 'us-east-1'
      const mockNodes = [
        { region: 'us-east-1', carbonIntensity: 300 },
      ];
      (mockPrisma.edgeNode!.findMany as any).mockResolvedValue(mockNodes);

      // Mock carbon intensity forecast
      const now = Date.now();
      const mockForecast = [
        { datetime: new Date(now).toISOString(), carbonIntensity: 300 },
        { datetime: new Date(now + 15 * 60 * 1000).toISOString(), carbonIntensity: 150 }, // lower carbon intensity window
        { datetime: new Date(now + 30 * 60 * 1000).toISOString(), carbonIntensity: 300 },
      ];
      vi.spyOn(scheduler['carbonClient'], 'getCarbonIntensityForecast').mockResolvedValue(mockForecast);
      vi.spyOn(scheduler['carbonClient'], 'mapRegionToZone').mockReturnValue('US-GD');

      const result = await scheduler['carbonShiftSchedule'](task);
      expect(result).toBe(true);

      // Verify that Redis was updated with the target time
      expect(mockRedis.set).toHaveBeenCalledWith(
        `task:deferred:${task.id}:until`,
        expect.any(String),
        'PX',
        expect.any(Number),
      );
    });

    it('should not defer task if maximum delay has already elapsed', async () => {
      const task = {
        id: 'task-expired',
        isDeferrable: true,
        maxDelayMinutes: 10,
        submittedAt: new Date(Date.now() - 15 * 60 * 1000), // submitted 15 minutes ago
      };

      const result = await scheduler['carbonShiftSchedule'](task);
      expect(result).toBe(false);
    });
  });

  describe('recordTaskOutcome', () => {
    it('should run contextual bandit feedback loop and save outcome', async () => {
      const task = {
        id: 'task-bandit',
        policy: 'ml-optimized',
        nodeId: 'node-1',
        tenantId: 'tenant-123',
        metadata: JSON.stringify({
          predictedScore: 0.8,
          modelVersion: '1.0.0',
        }),
        submittedAt: new Date(),
      };

      const decision = {
        taskId: 'task-bandit',
        explanation: JSON.stringify({
          context: new Array(12).fill(0.5),
        }),
      };

      const edgeNode = {
        id: 'node-1',
        carbonIntensity: 350,
        cpuUsage: 45,
      };

      vi.mocked(mockPrisma.task!.findUnique as any).mockResolvedValue(task);
      vi.mocked((mockPrisma as any).schedulingDecision.findUnique).mockResolvedValue(decision);
      vi.mocked(mockPrisma.edgeNode!.findUnique as any).mockResolvedValue(edgeNode);
      vi.mocked((mockPrisma as any).schedulingOutcome.create).mockResolvedValue({ id: 'outcome-1' });

      // Spy on MLScheduler.updateBandit
      const updateBanditSpy = vi.spyOn(scheduler['mlScheduler'], 'updateBandit').mockResolvedValue();

      await scheduler.recordTaskOutcome('task-bandit', 1500, 'COMPLETED');

      expect(updateBanditSpy).toHaveBeenCalledWith('node-1', expect.any(Array), expect.any(Number));
      expect((mockPrisma as any).schedulingOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskId: 'task-bandit',
          nodeId: 'node-1',
          tenantId: 'tenant-123',
          assignedAt: expect.any(Date),
          completedAt: expect.any(Date),
          status: 'COMPLETED',
          actualLatencyMs: 1500,
          predictedLatencyMs: 5000,
          carbonIntensityAtAssignment: 350,
          nodeLoadAtAssignment: 45,
          rewardScore: expect.any(Number),
        }),
      });
    });
  });
});
