import { describe, it, expect, beforeEach } from 'vitest';
import { Task, TaskStatus, TaskPriority } from '../src/domain/task';
import { EdgeNode, NodeStatus } from '../src/domain/node';

describe('Task', () => {
  describe('creation', () => {
    it('should create a task with default values', () => {
      const task = new Task({
        id: 'task-1',
        type: 'compute',
        command: 'echo hello',
      });
      
      expect(task.id).toBe('task-1');
      expect(task.type).toBe('compute');
      expect(task.status).toBe(TaskStatus.PENDING);
      expect(task.priority).toBe(TaskPriority.NORMAL);
    });

    it('should create a task with custom values', () => {
      const task = new Task({
        id: 'task-2',
        type: 'ml-inference',
        command: 'python model.py',
        priority: TaskPriority.HIGH,
        cpu: 2,
        memory: 4096,
        timeout: 300,
      });
      
      expect(task.priority).toBe(TaskPriority.HIGH);
      expect(task.cpu).toBe(2);
      expect(task.memory).toBe(4096);
      expect(task.timeout).toBe(300);
    });
  });

  describe('status transitions', () => {
    let task: Task;

    beforeEach(() => {
      task = new Task({
        id: 'task-1',
        type: 'compute',
        command: 'echo hello',
      });
    });

    it('should transition from PENDING to SCHEDULED', () => {
      task.schedule('node-1');
      
      expect(task.status).toBe(TaskStatus.SCHEDULED);
      expect(task.assignedNodeId).toBe('node-1');
    });

    it('should transition from SCHEDULED to RUNNING', () => {
      task.schedule('node-1');
      task.start();
      
      expect(task.status).toBe(TaskStatus.RUNNING);
      expect(task.startedAt).toBeDefined();
    });

    it('should transition from RUNNING to COMPLETED', () => {
      task.schedule('node-1');
      task.start();
      task.complete({ exitCode: 0, stdout: 'success' });
      
      expect(task.status).toBe(TaskStatus.COMPLETED);
      expect(task.completedAt).toBeDefined();
      expect(task.result?.exitCode).toBe(0);
    });

    it('should transition from RUNNING to FAILED', () => {
      task.schedule('node-1');
      task.start();
      task.fail('Process crashed');
      
      expect(task.status).toBe(TaskStatus.FAILED);
      expect(task.error).toBe('Process crashed');
    });

    it('should not allow invalid transitions', () => {
      // Cannot complete a pending task
      expect(() => task.complete({ exitCode: 0 })).toThrow();
      
      // Cannot start a pending task without scheduling
      expect(() => task.start()).toThrow();
    });
  });

  describe('timeout', () => {
    it('should check if task is timed out', () => {
      const task = new Task({
        id: 'task-1',
        type: 'compute',
        command: 'echo hello',
        timeout: 1, // 1 second
      });
      
      task.schedule('node-1');
      task.start();
      
      // Simulate time passing
      task.startedAt = new Date(Date.now() - 2000); // 2 seconds ago
      
      expect(task.isTimedOut()).toBe(true);
    });

    it('should not timeout if still within limit', () => {
      const task = new Task({
        id: 'task-1',
        type: 'compute',
        command: 'echo hello',
        timeout: 60, // 60 seconds
      });
      
      task.schedule('node-1');
      task.start();
      
      expect(task.isTimedOut()).toBe(false);
    });
  });

  describe('resource requirements', () => {
    it('should validate resource requirements', () => {
      const task = new Task({
        id: 'task-1',
        type: 'compute',
        command: 'echo hello',
        cpu: 4,
        memory: 8192,
        gpu: 1,
      });
      
      expect(task.cpu).toBe(4);
      expect(task.memory).toBe(8192);
      expect(task.gpu).toBe(1);
    });
  });

  describe('serialization', () => {
    it('should serialize to JSON', () => {
      const task = new Task({
        id: 'task-1',
        type: 'compute',
        command: 'echo hello',
      });
      
      const json = task.toJSON();
      
      expect(json.id).toBe('task-1');
      expect(json.type).toBe('compute');
      expect(json.status).toBe(TaskStatus.PENDING);
    });

    it('should deserialize from JSON', () => {
      const json = {
        id: 'task-1',
        type: 'compute',
        command: 'echo hello',
        status: TaskStatus.PENDING,
        priority: TaskPriority.NORMAL,
        createdAt: new Date().toISOString(),
      };
      
      const task = Task.fromJSON(json);
      
      expect(task.id).toBe('task-1');
      expect(task.status).toBe(TaskStatus.PENDING);
    });
  });
});

describe('EdgeNode', () => {
  describe('creation', () => {
    it('should create a node with default values', () => {
      const node = new EdgeNode({
        id: 'node-1',
        host: '192.168.1.1',
        port: 8080,
      });
      
      expect(node.id).toBe('node-1');
      expect(node.status).toBe(NodeStatus.OFFLINE);
    });

    it('should create a node with resources', () => {
      const node = new EdgeNode({
        id: 'node-1',
        host: '192.168.1.1',
        port: 8080,
        totalCpu: 8,
        totalMemory: 32768,
        totalGpu: 2,
        region: 'us-east',
      });
      
      expect(node.totalCpu).toBe(8);
      expect(node.totalMemory).toBe(32768);
      expect(node.totalGpu).toBe(2);
      expect(node.region).toBe('us-east');
    });
  });

  describe('status transitions', () => {
    let node: EdgeNode;

    beforeEach(() => {
      node = new EdgeNode({
        id: 'node-1',
        host: '192.168.1.1',
        port: 8080,
      });
    });

    it('should transition from OFFLINE to ONLINE', () => {
      node.goOnline();
      
      expect(node.status).toBe(NodeStatus.ONLINE);
    });

    it('should transition from ONLINE to OFFLINE', () => {
      node.goOnline();
      node.goOffline();
      
      expect(node.status).toBe(NodeStatus.OFFLINE);
    });

    it('should transition to BUSY when under load', () => {
      node.goOnline();
      node.setBusy();
      
      expect(node.status).toBe(NodeStatus.BUSY);
    });

    it('should transition to DRAINING', () => {
      node.goOnline();
      node.drain();
      
      expect(node.status).toBe(NodeStatus.DRAINING);
    });
  });

  describe('resource management', () => {
    let node: EdgeNode;

    beforeEach(() => {
      node = new EdgeNode({
        id: 'node-1',
        host: '192.168.1.1',
        port: 8080,
        totalCpu: 8,
        totalMemory: 16384,
      });
      
      node.goOnline();
    });

    it('should track available resources', () => {
      node.allocateResources({ cpu: 2, memory: 4096 });
      
      expect(node.availableCpu).toBe(6);
      expect(node.availableMemory).toBe(12288);
    });

    it('should release resources', () => {
      node.allocateResources({ cpu: 2, memory: 4096 });
      node.releaseResources({ cpu: 2, memory: 4096 });
      
      expect(node.availableCpu).toBe(8);
      expect(node.availableMemory).toBe(16384);
    });

    it('should check if resources are available', () => {
      expect(node.hasResources({ cpu: 4, memory: 8192 })).toBe(true);
      expect(node.hasResources({ cpu: 16, memory: 8192 })).toBe(false);
    });

    it('should calculate resource utilization', () => {
      node.allocateResources({ cpu: 4, memory: 8192 });
      
      expect(node.getCpuUtilization()).toBe(50); // 4/8 = 50%
      expect(node.getMemoryUtilization()).toBe(50); // 8192/16384 = 50%
    });
  });

  describe('health', () => {
    let node: EdgeNode;

    beforeEach(() => {
      node = new EdgeNode({
        id: 'node-1',
        host: '192.168.1.1',
        port: 8080,
      });
    });

    it('should track health score', () => {
      node.updateHealth(0.9);
      
      expect(node.healthScore).toBe(0.9);
    });

    it('should determine if node is healthy', () => {
      node.updateHealth(0.8);
      
      expect(node.isHealthy()).toBe(true);
    });

    it('should mark unhealthy below threshold', () => {
      node.updateHealth(0.3);
      
      expect(node.isHealthy()).toBe(false);
    });

    it('should track consecutive failures', () => {
      node.recordFailure();
      node.recordFailure();
      
      expect(node.consecutiveFailures).toBe(2);
    });

    it('should reset failures on success', () => {
      node.recordFailure();
      node.recordFailure();
      node.recordSuccess();
      
      expect(node.consecutiveFailures).toBe(0);
    });
  });
});
