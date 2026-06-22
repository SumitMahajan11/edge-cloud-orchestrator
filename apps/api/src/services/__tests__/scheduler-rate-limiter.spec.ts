import { SchedulerRateLimiter } from '../scheduler-rate-limiter';
import Redis from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';

// Mock Redis
vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => {
      const store: Record<string, string> = {};
      return {
        set: vi.fn().mockImplementation((key, val) => {
          store[key] = String(val);
          return 'OK';
        }),
        get: vi.fn().mockImplementation((key) => {
          return store[key] || null;
        }),
        del: vi.fn().mockImplementation((key) => {
          delete store[key];
          return 1;
        }),
        eval: vi.fn().mockImplementation(async (_script, _numKeys, ...args) => {
          // Mock the Lua script behavior for recordTaskCompleted
          // args: [pendingGlobal, pendingNode(nodeId)]
          const globalKey = args[0];
          const nodeKey = args[1];
          const globalVal = parseInt(store[globalKey] || '0', 10);
          const nodeVal = parseInt(store[nodeKey] || '0', 10);

          if (globalVal > 0) {
            store[globalKey] = String(globalVal - 1);
          }
          if (nodeVal > 0) {
            store[nodeKey] = String(nodeVal - 1);
          }
          return 1;
        }),
        pipeline: vi.fn().mockImplementation(() => {
          const pipelineCommands: any[] = [];
          const pipelineMock = {
            set: vi.fn().mockImplementation((key, val) => {
              pipelineCommands.push(() => {
                store[key] = String(val);
              });
              return pipelineMock;
            }),
            exec: vi.fn().mockImplementation(async () => {
              for (const cmd of pipelineCommands) {
                cmd();
              }
              return [];
            })
          };
          return pipelineMock;
        }),
        quit: vi.fn(),
      };
    }),
  };
});

describe('SchedulerRateLimiter', () => {
  let rateLimiter: SchedulerRateLimiter;
  let mockRedis: any;
  let mockLogger: Logger;
  let mockPrisma: any;

  beforeEach(() => {
    mockRedis = new Redis();
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    mockPrisma = {
      task: {
        count: vi.fn(),
        groupBy: vi.fn(),
      },
      edgeNode: {
        findMany: vi.fn(),
      },
    };

    rateLimiter = new SchedulerRateLimiter(mockRedis, mockLogger);
  });

  describe('checkRateLimit', () => {
    it('should ignore node-specific checks if nodeId is "pending"', async () => {
      // Set counters such that node limit is exceeded but global is not
      await mockRedis.set('scheduler:pending:global', '10');
      // Node limit is 100, let's set it to 101
      await mockRedis.set('scheduler:pending:node:node-1', '101');

      // Check rate limit with 'pending' nodeId
      // It should pass because node limits are ignored for placeholder 'pending'
      const check = await rateLimiter.checkRateLimit('task-1', 'user-1', 'pending');
      expect(check.allowed).toBe(true);
    });

    it('should enforce node-specific checks if real nodeId is provided', async () => {
      // Set node-specific counter to exceed limit
      // Max pending per node limit is 100
      await mockRedis.set('scheduler:pending:global', '10');
      await mockRedis.set('scheduler:pending:node:node-1', '101');

      const check = await rateLimiter.checkRateLimit('task-1', 'user-1', 'node-1');
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('pending task limit exceeded');
    });

    it('should enforce global and user-specific limits', async () => {
      // Max pending global is 5000, let's set global to 5001
      await mockRedis.set('scheduler:pending:global', '5001');

      const check = await rateLimiter.checkRateLimit('task-1', 'user-1', 'pending');
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Global pending task limit exceeded');
    });
  });

  describe('recordTaskCompleted (Lua-based Decrement)', () => {
    it('should atomically decrement global and node counters down to a floor of 0', async () => {
      await mockRedis.set('scheduler:pending:global', '2');
      await mockRedis.set('scheduler:pending:node:node-1', '1');

      await rateLimiter.recordTaskCompleted('node-1');

      expect(await mockRedis.get('scheduler:pending:global')).toBe('1');
      expect(await mockRedis.get('scheduler:pending:node:node-1')).toBe('0');

      // Decrement again, should stay at 0
      await rateLimiter.recordTaskCompleted('node-1');
      expect(await mockRedis.get('scheduler:pending:global')).toBe('0');
      expect(await mockRedis.get('scheduler:pending:node:node-1')).toBe('0');
    });
  });

  describe('reconcilePendingCounters', () => {
    it('should correct drift in global counter and sync node counters', async () => {
      // Mock DB counts
      mockPrisma.task.count.mockResolvedValue(15);
      mockPrisma.task.groupBy.mockResolvedValue([
        { nodeId: 'node-1', _count: { id: 10 } },
        { nodeId: 'node-2', _count: { id: 5 } }
      ]);
      mockPrisma.edgeNode.findMany.mockResolvedValue([
        { id: 'node-1' },
        { id: 'node-2' },
        { id: 'node-3' }
      ]);

      // Set incorrect values in Redis to simulate drift
      await mockRedis.set('scheduler:pending:global', '100'); // drift > 5
      await mockRedis.set('scheduler:pending:node:node-1', '0');
      await mockRedis.set('scheduler:pending:node:node-2', '0');
      await mockRedis.set('scheduler:pending:node:node-3', '10');

      const result = await rateLimiter.reconcilePendingCounters(mockPrisma as PrismaClient);

      expect(result.corrected).toBe(true);
      expect(result.before.global).toBe(100);
      expect(result.after.global).toBe(15);

      // Verify Redis values were reconciled
      expect(await mockRedis.get('scheduler:pending:global')).toBe('15');
      expect(await mockRedis.get('scheduler:pending:node:node-1')).toBe('10');
      expect(await mockRedis.get('scheduler:pending:node:node-2')).toBe('5');
      expect(await mockRedis.get('scheduler:pending:node:node-3')).toBe('0');
    });
  });
});
