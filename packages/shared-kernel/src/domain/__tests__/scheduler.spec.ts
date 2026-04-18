// Using globals
import { selectNode, SchedulingError } from '../scheduler';
import { createMockNode, createMockTask } from './factories';

describe('Scheduling Policies', () => {
  const weights = {
    latency: 0.2,
    cpu: 0.15,
    memory: 0.15,
    cost: 0.2,
    network: 0.1,
    ml: 0.1,
    health: 0.1,
  };

  describe('Latency-Aware Policy', () => {
    it('should select the node with lowest RTT when CPU < 80%', async () => {
      const node1 = createMockNode({ id: 'node-1', latency: 50, cpuUsage: 10 });
      const node2 = createMockNode({ id: 'node-2', latency: 10, cpuUsage: 70 });
      const node3 = createMockNode({ id: 'node-3', latency: 5, cpuUsage: 85 }); // Too high CPU
      
      const task = createMockTask({ policy: 'latency-aware' });
      const selected = await selectNode([node1, node2, node3], task, { weights });
      
      expect(selected.id).toBe('node-2');
    });

    it('should NOT select a node with CPU >= 80% even if it has lowest latency', async () => {
      const node1 = createMockNode({ id: 'node-1', latency: 10, cpuUsage: 85 });
      const node2 = createMockNode({ id: 'node-2', latency: 100, cpuUsage: 10 });
      
      const task = createMockTask({ policy: 'latency-aware' });
      const selected = await selectNode([node1, node2], task, { weights });
      
      expect(selected.id).toBe('node-2');
    });

    it('should fall back to round-robin (least tasks) when all nodes exceed CPU threshold', async () => {
      const node1 = createMockNode({ id: 'node-1', latency: 10, cpuUsage: 90, tasksRunning: 10 });
      const node2 = createMockNode({ id: 'node-2', latency: 100, cpuUsage: 90, tasksRunning: 2 });
      
      const task = createMockTask({ policy: 'latency-aware' });
      const selected = await selectNode([node1, node2], task, { weights });
      
      expect(selected.id).toBe('node-2');
    });
  });

  describe('Cost-Aware Policy', () => {
    it('should select the cheapest node that meets minimum performance thresholds', async () => {
      const node1 = createMockNode({ id: 'node1', costPerHour: 0.5, region: 'us-east-1' });
      const node2 = createMockNode({ id: 'node2', costPerHour: 0.3, region: 'us-east-1' });
      const node3 = createMockNode({ id: 'node3', costPerHour: 0.8, region: 'us-west-2' });

      const task = createMockTask({ policy: 'cost-aware' });
      const selected = await selectNode([node1, node2, node3], task, { weights });
      
      expect(selected.id).toBe('node2');
    });

    it('should apply cross-region cost premium (20%) correctly', async () => {
      // node1: 0.3 in us-east-1 (base) = 0.3
      // node2: 0.28 in eu-west-1 (cross-region) = 0.28 * 1.2 = 0.336
      const node1 = createMockNode({ id: 'node1', costPerHour: 0.3, region: 'us-east-1' });
      const node2 = createMockNode({ id: 'node2', costPerHour: 0.28, region: 'eu-west-1' });

      const task = createMockTask({ policy: 'cost-aware' });
      const selected = await selectNode([node1, node2], task, { weights });
      
      expect(selected.id).toBe('node1');
    });

    it('should handle nodes with equal cost by selecting lower latency', async () => {
      const node1 = createMockNode({ id: 'node1', costPerHour: 0.3, latency: 100 });
      const node2 = createMockNode({ id: 'node2', costPerHour: 0.3, latency: 50 });

      const task = createMockTask({ policy: 'cost-aware' });
      const selected = await selectNode([node1, node2], task, { weights });
      
      expect(selected.id).toBe('node2');
    });
  });

  describe('Load Balanced Policy', () => {
    it('should compute weighted score correctly: cpu*0.4 + memory*0.3 + latency*0.3', async () => {
      // node1: 50*0.4 + 50*0.3 + 50*0.3 = 20 + 15 + 15 = 50
      // node2: 10*0.4 + 10*0.3 + 500*0.3 = 4 + 3 + 150 = 157
      const node1 = createMockNode({ id: 'node1', cpuUsage: 50, memoryUsage: 50, latency: 50 });
      const node2 = createMockNode({ id: 'node2', cpuUsage: 10, memoryUsage: 10, latency: 500 });

      const task = createMockTask({ policy: 'load-balanced' });
      const selected = await selectNode([node1, node2], task, { weights });
      
      expect(selected.id).toBe('node1');
    });

    it('should handle empty candidate list gracefully by throwing SchedulingError', async () => {
      const task = createMockTask({ policy: 'load-balanced' });
      await expect(selectNode([], task, { weights })).rejects.toThrow(SchedulingError);
    });

    it('should throw SchedulingError when all nodes are OFFLINE', async () => {
      const node = createMockNode({ status: 'OFFLINE' });
      const task = createMockTask();
      await expect(selectNode([node], task, { weights })).rejects.toThrow(SchedulingError);
    });
  });
});
