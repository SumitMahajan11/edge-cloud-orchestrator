import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pino } from 'pino';
import { ConsistencyCheckerJob } from '../consistency-checker';
import * as metrics from '../../services/metrics-service';

// Mock metrics
vi.mock('../../services/metrics-service', () => ({
  consistencyViolationsTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
  consistencyAutoFixesTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
}));

// Mock AWS S3
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: vi.fn() })),
  PutObjectCommand: vi.fn(),
}));

describe('ConsistencyCheckerJob', () => {
  let prisma: any;
  let logger: any;
  let job: ConsistencyCheckerJob;

  beforeEach(() => {
    prisma = {
      $queryRawUnsafe: vi.fn(),
      auditLog: { create: vi.fn() },
      task: { updateMany: vi.fn() },
      edgeNode: { updateMany: vi.fn() },
      $transaction: vi.fn((cb) => (typeof cb === 'function' ? cb(prisma) : cb)),
    };
    logger = pino({ level: 'silent' });
    job = new ConsistencyCheckerJob(prisma as any, logger, 3);

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('should detect invariant violations and report them', async () => {
    // Mock violations for Invariant 1 (TASK_EXECUTION_SYNC)
    prisma.$queryRawUnsafe.mockImplementation((query: string) => {
      if (
        query.includes('tasks t') &&
        query.includes('HAVING COUNT(te.id) != 1')
      ) {
        return Promise.resolve([
          { id: 'task-1', name: 'Broken Task', running_executions: 0 },
        ]);
      }
      return Promise.resolve([]);
    });

    await job.run();

    // Verify detection
    expect(prisma.$queryRawUnsafe).toHaveBeenCalled();
    expect(metrics.consistencyViolationsTotal.labels).toHaveBeenCalledWith(
      'TASK_EXECUTION_SYNC',
    );

    // Verify audit log creation
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'CONSISTENCY_VIOLATION',
          tenantId: 'SYSTEM',
        }),
      }),
    );
  });

  it('should apply safe fixes for stuck tasks', async () => {
    // Mock stuck tasks for STUCK_SCHEDULING fix
    prisma.$queryRawUnsafe.mockImplementation((query: string) => {
      if (
        query.includes("status = 'SCHEDULED'") &&
        query.includes("INTERVAL '10 minutes'")
      ) {
        return Promise.resolve([{ id: 'task-stuck' }]);
      }
      return Promise.resolve([]);
    });

    prisma.task.updateMany.mockResolvedValue({ count: 1 });

    await job.run();

    // Verify fix was applied
    expect(prisma.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['task-stuck'] } },
        data: expect.objectContaining({ status: 'PENDING' }),
      }),
    );

    // Verify metric emission
    expect(metrics.consistencyAutoFixesTotal.labels).toHaveBeenCalledWith(
      'STUCK_SCHEDULING',
      'success',
    );
  });

  it('should handle offline nodes and reassign tasks', async () => {
    // Mock ghost node
    prisma.$queryRawUnsafe.mockImplementation((query: string) => {
      if (
        query.includes("status = 'ONLINE'") &&
        query.includes("INTERVAL '5 minutes'")
      ) {
        return Promise.resolve([{ id: 'node-dead' }]);
      }
      return Promise.resolve([]);
    });

    await job.run();

    // Verify node marked as OFFLINE
    expect(prisma.edgeNode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['node-dead'] } },
        data: { status: 'OFFLINE' },
      }),
    );

    // Verify tasks reassigned
    expect(prisma.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          nodeId: { in: ['node-dead'] },
          status: 'RUNNING',
        },
        data: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
  });

  it('should schedule the job to run at the correct hour', async () => {
    const runSpy = vi.spyOn(job, 'run').mockResolvedValue();

    // Set time to 3:00 AM
    vi.setSystemTime(new Date('2024-01-01T03:00:00Z'));

    job.start();

    // Advance timers by more than 1 minute to ensure it ticks
    await vi.advanceTimersByTimeAsync(120000);

    expect(runSpy).toHaveBeenCalled();
  });
});
