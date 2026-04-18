import { DomainNode, DomainTask, Priority } from '../types/domain';

export const createMockNode = (overrides: Partial<DomainNode> = {}): DomainNode => ({
  id: `node-${Math.random().toString(36).substr(2, 9)}`,
  url: 'http://localhost:3000',
  status: 'ONLINE',
  tasksRunning: 0,
  cpuUsage: 10,
  memoryUsage: 10,
  latency: 10,
  costPerHour: 0.1,
  region: 'us-east-1',
  ...overrides,
});

export const createMockTask = (overrides: Partial<DomainTask> = {}): DomainTask => ({
  id: `task-${Math.random().toString(36).substr(2, 9)}`,
  priority: 'MEDIUM' as Priority,
  policy: 'load-balanced',
  requirements: {
    cpu: 1,
    memory: 512,
  },
  ...overrides,
});
