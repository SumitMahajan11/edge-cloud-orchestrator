import { TaskScheduler } from '../task-scheduler';
import axios from 'axios';
// Rely on globals

vi.mock('axios');
vi.mock('ioredis');

describe('TaskScheduler Audit Model', () => {
  let scheduler: TaskScheduler;
  let mockPrisma: any;
  let mockRedis: any;
  let mockWsManager: any;
  let mockLogger: any;

  beforeEach(() => {
    mockPrisma = {
      task: {
        update: vi.fn().mockImplementation((args) => Promise.resolve({ 
          id: args.where.id, 
          maxRetries: 3, 
          status: args.data.status || 'PENDING',
          submittedAt: new Date() 
        })),
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      taskExecution: {
        findFirst: vi.fn(),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: `exec-${data.attemptNumber}`, ...data })),
        update: vi.fn(),
        count: vi.fn(),
      },
      edgeNode: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      schedulingDecision: {
        upsert: vi.fn(),
      },
      $transaction: vi.fn((ops) => Promise.all(ops)),
    };

    mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      setex: vi.fn(),
      zadd: vi.fn(),
      zrem: vi.fn(),
      expire: vi.fn(),
    };

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
      mockPrisma as any,
      mockRedis as any,
      mockWsManager as any,
      mockLogger as any
    );
  });

  it('should maintain 1 Task but create multiple TaskExecutions on failure', async () => {
    const task = { 
      id: 'task-1', 
      name: 'Audit Test Task', 
      maxRetries: 3, 
      status: 'PENDING',
      policy: 'auto',
      type: 'COMPUTE',
      input: {},
      submittedAt: new Date()
    };
    const node = { id: 'node-1', url: 'http://node-1' };

    // --- FAILURE 1 ---
    mockPrisma.taskExecution.findFirst.mockResolvedValueOnce(null); // No execution yet, fallback will create one
    vi.mocked(axios.post).mockRejectedValueOnce(new Error('First failure'));

    await (scheduler as any).assignTask(task, node);

    // Verify task.create was NOT called (no cloning)
    expect(mockPrisma.task.create).not.toHaveBeenCalled();
    
    // Verify initial execution (attempt 1) was created via fallback
    expect(mockPrisma.taskExecution.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ attemptNumber: 1, status: 'PENDING' })
    }));
    
    // Verify next execution (attempt 2) was created as a retry
    expect(mockPrisma.taskExecution.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ attemptNumber: 2, status: 'PENDING', retryOf: 'exec-1' })
    }));

    // --- FAILURE 2 ---
    // Reset mocks for second run
    mockPrisma.taskExecution.findFirst.mockResolvedValueOnce({ id: 'exec-2', attemptNumber: 2 });
    vi.mocked(axios.post).mockRejectedValueOnce(new Error('Second failure'));
    
    await (scheduler as any).assignTask(task, node);

    // Still no task cloning
    expect(mockPrisma.task.create).not.toHaveBeenCalled();

    // Verify execution 3 (retry) was created
    expect(mockPrisma.taskExecution.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ attemptNumber: 3, status: 'PENDING', retryOf: 'exec-2' })
    }));

    // --- FINAL ASSERTIONS ---
    // Total executions created: 
    // 1 (initial fallback) + 1 (retry 1) + 1 (retry 2) = 3
    const executionCreates = mockPrisma.taskExecution.create.mock.calls;
    expect(executionCreates.length).toBe(3);
    
    expect(executionCreates[0][0].data.attemptNumber).toBe(1);
    expect(executionCreates[1][0].data.attemptNumber).toBe(2);
    expect(executionCreates[1][0].data.retryOf).toBe('exec-1');
    
    expect(executionCreates[2][0].data.attemptNumber).toBe(3);
    expect(executionCreates[2][0].data.retryOf).toBe('exec-2');
    
    // Task status should be back to PENDING for the next try
    expect(mockPrisma.task.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'task-1' },
      data: expect.objectContaining({ status: 'PENDING' })
    }));
  });
});
