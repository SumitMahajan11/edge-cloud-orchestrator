import { MLScheduler } from '../ml-scheduler';
import { createMockNode, createMockTask } from '../../../shared-kernel/src/domain/__tests__/factories';

// Mock dependencies
const mockPredictor = {
  getVersion: vi.fn(),
  getFeatureImportance: vi.fn().mockResolvedValue([]),
  updateModel: vi.fn(),
};

const mockRegistry = {
  getActiveVersion: vi.fn(),
};

const mockDriftDetector = {
  isDrifting: vi.fn(),
};

const mockMetrics = {
  recordMLFallback: vi.fn(),
  recordSchedulingDecision: vi.fn(),
  recordMetric: vi.fn(),
  recordCarbonMetrics: vi.fn(),
};

const mockOutcomeCollector = {
  getReward: vi.fn().mockResolvedValue(0.0),
};

describe('MLScheduler Fallback Logic', () => {
  let scheduler: MLScheduler;
  const weights = { latency: 0.2, cpu: 0.2, memory: 0.2, cost: 0.2, network: 0.1, ml: 0.1, health: 0 };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    scheduler = new MLScheduler(
      mockPredictor as any,
      mockRegistry as any,
      mockDriftDetector as any,
      mockMetrics as any,
      mockOutcomeCollector as any
    );
    mockDriftDetector.isDrifting.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should fall back when prediction takes > 50ms', async () => {
    const nodes = [
      createMockNode({ id: 'node-1', cpuUsage: 80, tasksRunning: 10 }),
      createMockNode({ id: 'node-2', cpuUsage: 20, tasksRunning: 1 })
    ];
    const task = createMockTask();

    // Mock rankNodes to never resolve or at least take a long time
    const rankNodesMock = vi.spyOn((scheduler as any).scorer, 'rankNodes').mockImplementation(() => {
      return new Promise((resolve) => {
        setTimeout(() => resolve([{ nodeId: 'node-1', score: 0.9, components: {} }]), 100);
      });
    });

    const promise = scheduler.schedule(task as any, nodes as any, weights);
    
    // Advance time by 51ms
    await vi.advanceTimersByTimeAsync(51);
    
    const result = await promise;

    expect(result?.fallbackUsed).toBe(true);
    expect(result?.decision.nodeId).toBe('node-2'); // Load balanced: least tasks
    expect(mockMetrics.recordMLFallback).toHaveBeenCalledWith('timeout', 'load-balanced');
  });

  it('should fall back to Load Balanced when prediction throws', async () => {
    const nodes = [
      createMockNode({ id: 'node-1', cpuUsage: 80, tasksRunning: 10 }),
      createMockNode({ id: 'node-2', cpuUsage: 20, tasksRunning: 1 })
    ];
    const task = createMockTask();

    vi.spyOn((scheduler as any).scorer, 'rankNodes').mockRejectedValue(new Error('GPU Out of Memory'));

    const result = await scheduler.schedule(task as any, nodes as any, weights);

    expect(result?.fallbackUsed).toBe(true);
    expect(result?.decision.nodeId).toBe('node-2');
    expect(mockMetrics.recordMLFallback).toHaveBeenCalledWith('error', 'load-balanced');
  });

  it('should log a fallback event on every fallback', async () => {
    const nodes = [createMockNode()];
    const task = createMockTask();
    
    mockDriftDetector.isDrifting.mockReturnValue(true);
    
    await scheduler.schedule(task as any, nodes as any, weights);
    
    expect(mockMetrics.recordMLFallback).toHaveBeenCalledWith('drift', 'load-balanced');
  });
});
