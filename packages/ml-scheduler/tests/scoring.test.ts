import { describe, it, expect, beforeEach } from 'vitest';
import { MultiObjectiveScorer } from '../src/scoring';

describe('MultiObjectiveScorer', () => {
  let scorer: MultiObjectiveScorer;

  beforeEach(() => {
    scorer = new MultiObjectiveScorer();
  });

  describe('node scoring', () => {
    const mockNodes = [
      {
        id: 'node-1',
        cpuUsage: 30,
        memoryUsage: 40,
        networkLatency: 10,
        availableMemory: 8192,
        totalMemory: 16384,
        region: 'us-east',
        costPerHour: 0.10,
      },
      {
        id: 'node-2',
        cpuUsage: 80,
        memoryUsage: 90,
        networkLatency: 50,
        availableMemory: 1024,
        totalMemory: 16384,
        region: 'us-west',
        costPerHour: 0.20,
      },
      {
        id: 'node-3',
        cpuUsage: 50,
        memoryUsage: 50,
        networkLatency: 20,
        availableMemory: 4096,
        totalMemory: 16384,
        region: 'eu-west',
        costPerHour: 0.15,
      },
    ];

    it('should score all nodes', () => {
      const results = scorer.scoreNodes(mockNodes as any);
      
      expect(results).toHaveLength(3);
      expect(results[0].nodeId).toBeDefined();
      expect(results[0].totalScore).toBeGreaterThanOrEqual(0);
      expect(results[0].totalScore).toBeLessThanOrEqual(1);
    });

    it('should prefer nodes with lower CPU usage', () => {
      const results = scorer.scoreNodes(mockNodes as any);
      
      // node-1 has lowest CPU usage (30%)
      const node1Score = results.find(r => r.nodeId === 'node-1')!;
      const node2Score = results.find(r => r.nodeId === 'node-2')!;
      
      expect(node1Score.scores.cpu).toBeGreaterThan(node2Score.scores.cpu);
    });

    it('should prefer nodes with lower memory usage', () => {
      const results = scorer.scoreNodes(mockNodes as any);
      
      // node-1 has lowest memory usage (40%)
      const node1Score = results.find(r => r.nodeId === 'node-1')!;
      const node2Score = results.find(r => r.nodeId === 'node-2')!;
      
      expect(node1Score.scores.memory).toBeGreaterThan(node2Score.scores.memory);
    });

    it('should prefer nodes with lower latency', () => {
      const results = scorer.scoreNodes(mockNodes as any);
      
      // node-1 has lowest latency (10ms)
      const node1Score = results.find(r => r.nodeId === 'node-1')!;
      const node3Score = results.find(r => r.nodeId === 'node-3')!;
      
      expect(node1Score.scores.latency).toBeGreaterThan(node3Score.scores.latency);
    });

    it('should return sorted results by default', () => {
      const results = scorer.scoreNodes(mockNodes as any);
      
      for (let i = 1; i < results.length; i++) {
        expect(results[i-1].totalScore).toBeGreaterThanOrEqual(results[i].totalScore);
      }
    });
  });

  describe('custom weights', () => {
    it('should use custom weights for scoring', () => {
      const customScorer = new MultiObjectiveScorer({
        latency: 0.5,
        cpu: 0.3,
        memory: 0.1,
        cost: 0.1,
        network: 0.0,
      });
      
      const nodes = [
        { id: 'high-latency', cpuUsage: 10, memoryUsage: 10, networkLatency: 100, availableMemory: 8192, totalMemory: 16384, costPerHour: 0.05 },
        { id: 'low-latency', cpuUsage: 90, memoryUsage: 90, networkLatency: 5, availableMemory: 1024, totalMemory: 16384, costPerHour: 0.50 },
      ];
      
      const results = customScorer.scoreNodes(nodes as any);
      
      // With latency weight of 0.5, low-latency node should win despite high CPU
      expect(results[0].nodeId).toBe('low-latency');
    });
  });

  describe('score calculation', () => {
    it('should calculate CPU score correctly', () => {
      const score = scorer.calculateCpuScore(50);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should give higher score to lower CPU usage', () => {
      const lowCpuScore = scorer.calculateCpuScore(20);
      const highCpuScore = scorer.calculateCpuScore(80);
      
      expect(lowCpuScore).toBeGreaterThan(highCpuScore);
    });

    it('should calculate memory score correctly', () => {
      const score = scorer.calculateMemoryScore(50);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should calculate latency score correctly', () => {
      const score = scorer.calculateLatencyScore(30);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should penalize high latency', () => {
      const lowLatencyScore = scorer.calculateLatencyScore(10);
      const highLatencyScore = scorer.calculateLatencyScore(200);
      
      expect(lowLatencyScore).toBeGreaterThan(highLatencyScore);
    });
  });

  describe('edge cases', () => {
    it('should handle empty node list', () => {
      const results = scorer.scoreNodes([]);
      expect(results).toEqual([]);
    });

    it('should handle single node', () => {
      const nodes = [
        { id: 'only-node', cpuUsage: 50, memoryUsage: 50, networkLatency: 20, availableMemory: 4096, totalMemory: 8192, costPerHour: 0.10 },
      ];
      
      const results = scorer.scoreNodes(nodes as any);
      
      expect(results).toHaveLength(1);
      expect(results[0].nodeId).toBe('only-node');
    });

    it('should handle extreme values', () => {
      const nodes = [
        { id: 'extreme', cpuUsage: 100, memoryUsage: 100, networkLatency: 1000, availableMemory: 0, totalMemory: 16384, costPerHour: 10 },
      ];
      
      const results = scorer.scoreNodes(nodes as any);
      
      expect(results[0].totalScore).toBeGreaterThanOrEqual(0);
    });
  });
});
