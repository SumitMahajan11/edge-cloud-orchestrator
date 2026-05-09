import { MultiObjectiveScorer, ScoreWeights } from '../scoring';
import { SchedulingPredictor } from '../predictor';
import { EdgeNode, Task } from '@edgecloud/shared-kernel';

vi.mock('../predictor');

describe('MultiObjectiveScorer', () => {
  let scorer: MultiObjectiveScorer;
  let predictor: vi.Mocked<SchedulingPredictor>;

  const mockTask: Task = {
    id: 'task-1',
    name: 'Test Task',
    type: 'CUSTOM',
    status: 'PENDING',
    priority: 'MEDIUM',
    target: 'EDGE',
    submittedAt: new Date(),
    maxRetries: 3,
    runtime: 'DOCKER'
  } as any;

  const baseNode: EdgeNode = {
    id: 'node-1',
    status: 'ONLINE',
    cpuUsage: 50,
    memoryUsage: 50,
    latency: 100,
    costPerHour: 0.5,
    carbonIntensity: 500,
    bandwidthInMbps: 100,
    healthScore: 1.0,
    tasksRunning: 0,
    maxTasks: 10,
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    predictor = new SchedulingPredictor() as any;
    predictor.predictAsync.mockResolvedValue(0.5);
    scorer = new MultiObjectiveScorer(predictor);
  });

  describe('Score ordering', () => {
    it('should rank nodes correctly based on profiles', async () => {
      const node1 = { ...baseNode, id: 'low-latency', latency: 10, cpuUsage: 90 };
      const node2 = { ...baseNode, id: 'low-cpu', latency: 200, cpuUsage: 10 };
      const node3 = { ...baseNode, id: 'balanced', latency: 100, cpuUsage: 50 };

      const weights: ScoreWeights = {
        latency: 0.4,
        cpu: 0.4,
        memory: 0.2,
        cost: 0,
        network: 0,
        ml: 0,
        health: 0,
        carbon: 0
      };
      
      scorer = new MultiObjectiveScorer(predictor, weights);
      const ranked = await scorer.rankNodes(mockTask, [node1, node2, node3]);
      
      expect(ranked[0].nodeId).toBe('low-cpu'); // 0.4*0.6 + 0.4*0.9 = 0.24 + 0.36 = 0.6
      expect(ranked[1].nodeId).toBe('balanced'); // 0.4*0.8 + 0.4*0.5 = 0.32 + 0.20 = 0.52
      expect(ranked[2].nodeId).toBe('low-latency'); // 0.4*0.98 + 0.4*0.1 = 0.392 + 0.04 = 0.432
    });
  });

  describe('Weight sensitivity', () => {
    it('should penalize cost-heavy nodes when cost weight is high', async () => {
      const cheapNode = { ...baseNode, id: 'cheap', costPerHour: 0.1, latency: 400 };
      const expensiveNode = { ...baseNode, id: 'expensive', costPerHour: 0.9, latency: 10 };

      const weights: ScoreWeights = {
        latency: 0.1,
        cost: 0.9,
        cpu: 0,
        memory: 0,
        network: 0,
        ml: 0,
        health: 0,
        carbon: 0
      };

      scorer = new MultiObjectiveScorer(predictor, weights);
      const ranked = await scorer.rankNodes(mockTask, [cheapNode, expensiveNode]);
      
      expect(ranked[0].nodeId).toBe('cheap');
      expect(ranked[1].nodeId).toBe('expensive');
    });
  });

  describe('Carbon weight', () => {
    it('should prioritize low-carbon nodes when carbon weight > 0', async () => {
      const cleanNode = { ...baseNode, id: 'clean', carbonIntensity: 50 };
      const dirtyNode = { ...baseNode, id: 'dirty', carbonIntensity: 900 };

      const weights: ScoreWeights = {
        carbon: 1.0,
        latency: 0,
        cpu: 0,
        memory: 0,
        cost: 0,
        network: 0,
        ml: 0,
        health: 0
      };

      scorer = new MultiObjectiveScorer(predictor, weights);
      const ranked = await scorer.rankNodes(mockTask, [cleanNode, dirtyNode]);
      
      expect(ranked[0].nodeId).toBe('clean');
      expect(ranked[1].nodeId).toBe('dirty');
    });
  });

  describe('Edge cases', () => {
    it('should score node with 0% CPU available below 50% available', async () => {
      const fullNode = { ...baseNode, id: 'full', cpuUsage: 100 };
      const halfNode = { ...baseNode, id: 'half', cpuUsage: 50 };

      const weights: ScoreWeights = {
        cpu: 1.0,
        latency: 0,
        memory: 0,
        cost: 0,
        network: 0,
        ml: 0,
        health: 0,
        carbon: 0
      };

      scorer = new MultiObjectiveScorer(predictor, weights);
      const ranked = await scorer.rankNodes(mockTask, [fullNode, halfNode]);
      
      expect(ranked[0].nodeId).toBe('half');
      expect(ranked[1].nodeId).toBe('full');
      expect(ranked[1].score).toBe(0);
    });

    it('should give median score to node with NULL latency (if handled as default)', async () => {
      // In our implementation, normalizeLatency handles 0-500ms. 
      // If we pass undefined, it might NaN. Let's see how it's implemented.
      // current implementation: return Math.max(0, 1 - latency / maxLatency);
      // We should probably handle null/undefined in implementation if needed, 
      // but the test asks to assert it gets median score.
      
      const nullLatencyNode = { ...baseNode, id: 'null-latency', latency: null as any };
      const lowLatencyNode = { ...baseNode, id: 'low', latency: 10 };
      const highLatencyNode = { ...baseNode, id: 'high', latency: 490 };

      // I'll update normalizeLatency to handle null/undefined as 250ms (median)
      // Wait, let's just do it in the test and then fix the code.
      
      const weights: ScoreWeights = {
        latency: 1.0,
        cpu: 0,
        memory: 0,
        cost: 0,
        network: 0,
        ml: 0,
        health: 0,
        carbon: 0
      };

      scorer = new MultiObjectiveScorer(predictor, weights);
      const ranked = await scorer.rankNodes(mockTask, [nullLatencyNode, lowLatencyNode, highLatencyNode]);
      
      const nullScore = ranked.find(n => n.nodeId === 'null-latency')?.score;
      expect(nullScore).toBeGreaterThan(0.4);
      expect(nullScore).toBeLessThan(0.6);
    });

    it('should return empty result for empty node list', async () => {
      const ranked = await scorer.rankNodes(mockTask, []);
      expect(ranked).toHaveLength(0);
    });
  });
});
