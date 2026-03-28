import { describe, it, expect, beforeEach } from 'vitest';
import { MultiObjectiveScorer, SchedulingPredictor } from '../src';

describe('MultiObjectiveScorer', () => {
  let scorer: MultiObjectiveScorer;
  let predictor: SchedulingPredictor;

  beforeEach(() => {
    predictor = new SchedulingPredictor();
    scorer = new MultiObjectiveScorer(predictor, {
      latency: 0.20,
      cpu: 0.15,
      memory: 0.15,
      cost: 0.10,
      network: 0.10,
      ml: 0.15,
      health: 0.15,
    });
  });

  describe('calculateScore', () => {
    it('should return a score between 0 and 1', () => {
      const task = createMockTask();
      const node = createMockNode();

      const result = scorer.calculateScore(task, node);
      
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it('should prefer nodes with lower latency', () => {
      const task = createMockTask();
      const fastNode = createMockNode({ latency: 10 });
      const slowNode = createMockNode({ latency: 200 });

      const fastResult = scorer.calculateScore(task, fastNode);
      const slowResult = scorer.calculateScore(task, slowNode);

      expect(fastResult.score).toBeGreaterThan(slowResult.score);
    });

    it('should prefer nodes with more available resources', () => {
      const task = createMockTask();
      const availableNode = createMockNode({ cpuUsage: 20, memoryUsage: 30 });
      const busyNode = createMockNode({ cpuUsage: 80, memoryUsage: 90 });

      const availableResult = scorer.calculateScore(task, availableNode);
      const busyResult = scorer.calculateScore(task, busyNode);

      expect(availableResult.score).toBeGreaterThan(busyResult.score);
    });

    it('should prefer cheaper nodes', () => {
      const task = createMockTask();
      const cheapNode = createMockNode({ costPerHour: 0.05 });
      const expensiveNode = createMockNode({ costPerHour: 0.50 });

      const cheapResult = scorer.calculateScore(task, cheapNode);
      const expensiveResult = scorer.calculateScore(task, expensiveNode);

      expect(cheapResult.score).toBeGreaterThan(expensiveResult.score);
    });

    it('should return all score components', () => {
      const task = createMockTask();
      const node = createMockNode();

      const result = scorer.calculateScore(task, node);

      expect(result.components).toHaveProperty('latency');
      expect(result.components).toHaveProperty('cpu');
      expect(result.components).toHaveProperty('memory');
      expect(result.components).toHaveProperty('cost');
      expect(result.components).toHaveProperty('network');
      expect(result.components).toHaveProperty('mlPrediction');
    });
  });
});

describe('SchedulingPredictor', () => {
  let predictor: SchedulingPredictor;

  beforeEach(() => {
    predictor = new SchedulingPredictor();
  });

  describe('predictSuccess', () => {
    it('should return probability between 0 and 1', () => {
      const task = createMockTask();
      const node = createMockNode();

      const probability = predictor.predictSuccess(task, node);
      
      expect(probability).toBeGreaterThanOrEqual(0);
      expect(probability).toBeLessThanOrEqual(1);
    });
  });

  describe('predictDuration', () => {
    it('should return positive duration', () => {
      const task = createMockTask({ type: 'IMAGE_CLASSIFICATION' });
      const node = createMockNode();

      const duration = predictor.predictDuration(task, node);
      
      expect(duration).toBeGreaterThan(0);
    });
  });

  describe('training', () => {
    it('should accept training data', async () => {
      const trainingData = [
        {
          taskType: 1,
          priority: 2,
          cpuRequirement: 2,
          memoryRequirement: 4096,
          nodeCpuAvailable: 80,
          nodeMemoryAvailable: 8192,
          nodeLatency: 50,
          timeOfDay: 12,
          dayOfWeek: 3,
          success: true,
          duration: 5000,
        },
        {
          taskType: 2,
          priority: 1,
          cpuRequirement: 4,
          memoryRequirement: 8192,
          nodeCpuAvailable: 60,
          nodeMemoryAvailable: 4096,
          nodeLatency: 30,
          timeOfDay: 14,
          dayOfWeek: 4,
          success: false,
          duration: 10000,
        },
      ];

      // train() needs 100+ examples, so this will log a warning but not throw
      await expect(predictor.train(trainingData as any)).resolves.not.toThrow();
    });
  });
});

// Helpers
function createMockTask(overrides: any = {}) {
  return {
    id: 'task-1',
    name: 'Test Task',
    type: 'IMAGE_CLASSIFICATION',
    status: 'PENDING',
    priority: 'MEDIUM',
    target: 'EDGE',
    policy: 'auto',
    reason: '',
    maxRetries: 3,
    retryCount: 0,
    region: 'us-east',
    submittedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockNode(overrides: any = {}) {
  return {
    id: 'node-1',
    name: 'Test Node',
    location: 'US East',
    region: 'us-east',
    status: 'ONLINE',
    ipAddress: '192.168.1.1',
    port: 8080,
    url: 'http://192.168.1.1:8080',
    cpuCores: 8,
    memoryGB: 16,
    storageGB: 100,
    cpuUsage: 50,
    memoryUsage: 60,
    storageUsage: 40,
    latency: 100,
    tasksRunning: 2,
    maxTasks: 10,
    costPerHour: 0.10,
    bandwidthInMbps: 1000,
    bandwidthOutMbps: 500,
    isMaintenanceMode: false,
    healthScore: 0.9,
    consecutiveFailures: 0,
    capabilities: ['gpu', 'ml'],
    lastHeartbeat: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
