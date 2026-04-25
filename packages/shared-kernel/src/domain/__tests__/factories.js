"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMockTask = exports.createMockNode = void 0;
const createMockNode = (overrides = {}) => ({
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
exports.createMockNode = createMockNode;
const createMockTask = (overrides = {}) => ({
    id: `task-${Math.random().toString(36).substr(2, 9)}`,
    priority: 'MEDIUM',
    policy: 'load-balanced',
    requirements: {
        cpu: 1,
        memory: 512,
    },
    ...overrides,
});
exports.createMockTask = createMockTask;
//# sourceMappingURL=factories.js.map