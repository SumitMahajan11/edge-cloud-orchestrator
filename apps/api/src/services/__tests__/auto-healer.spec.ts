import { AutoHealer } from '../auto-healer';
import { createMockNode, createMockTask } from '../../../../../packages/shared-kernel/src/domain/__tests__/factories';

// Mock dependencies
const mockPrisma = {
  task: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  edgeNode: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  taskExecution: {
    count: vi.fn(),
  },
};

const mockRedis = {
  duplicate: vi.fn().mockReturnValue({
    on: vi.fn(),
    subscribe: vi.fn(),
  }),
  zadd: vi.fn(),
};

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('AutoHealer', () => {
  let autoHealer: AutoHealer;

  beforeEach(() => {
    vi.clearAllMocks();
    autoHealer = new AutoHealer(
      mockPrisma as any,
      mockRedis as any,
      mockLogger as any,
      { cooldownMs: 0 }
    );
  });

  describe('Task Retry Logic', () => {
    it('should trigger re-scheduling when task status = FAILED and retry count < maxRetries', async () => {
      const failedTask = { id: 'task-1', status: 'FAILED', maxRetries: 3 };
      mockPrisma.task.findMany.mockResolvedValue([failedTask]);
      mockPrisma.taskExecution.count.mockResolvedValue(1); // 1 success/fail attempt so far, < 3

      // We need to trigger the private method checkFailedTasks. 
      // In a real health check it's called by performHealthChecks.
      await (autoHealer as any).checkFailedTasks();

      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          status: 'PENDING',
          nodeId: null,
        }),
      });
      expect(mockRedis.zadd).toHaveBeenCalledWith('task:queue', expect.any(Number), 'task-1');
    });

    it('should NOT retry when retry count >= maxRetries', async () => {
      const failedTask = { id: 'task-1', status: 'FAILED', maxRetries: 3 };
      mockPrisma.task.findMany.mockResolvedValue([failedTask]);
      mockPrisma.taskExecution.count.mockResolvedValue(3); // Already attempted 3 times

      await (autoHealer as any).checkFailedTasks();

      // Should move to FAILED_PERMANENT instead of PENDING
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          status: 'FAILED_PERMANENT',
        }),
      });
      expect(mockRedis.zadd).not.toHaveBeenCalled();
    });

    it('should update task status to FAILED_PERMANENT after max retries', async () => {
      const failedTask = { id: 'task-1', status: 'FAILED', maxRetries: 1 };
      mockPrisma.task.findMany.mockResolvedValue([failedTask]);
      mockPrisma.taskExecution.count.mockResolvedValue(1);

      await (autoHealer as any).checkFailedTasks();

      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          status: 'FAILED_PERMANENT',
          reason: 'Max retries exceeded',
        }),
      });
    });
  });
});
