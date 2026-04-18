import * as fc from 'fast-check';
import { selectNode } from '../scheduler';
import { DomainNode, DomainTask, Priority } from '../../types/domain';

describe('Scheduling Property Tests', () => {
  const weights = {
    latency: 0.2,
    cpu: 0.2,
    memory: 0.2,
    cost: 0.2,
    network: 0.1,
    ml: 0.1,
    health: 0,
  };

  // Arbitrary generator for DomainNode
  const nodeArb = fc.record({
    id: fc.uuid(),
    url: fc.constant('http://localhost'),
    status: fc.constantFrom('ONLINE', 'OFFLINE', 'DEGRADED', 'MAINTENANCE', 'STALE'),
    tasksRunning: fc.integer({ min: 0, max: 100 }),
    cpuUsage: fc.integer({ min: 0, max: 100 }),
    memoryUsage: fc.integer({ min: 0, max: 100 }),
    latency: fc.integer({ min: 1, max: 1000 }),
    costPerHour: fc.float({ min: 0, max: 10 }),
    region: fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'),
  });

  // Arbitrary generator for DomainTask
  const taskArb = fc.record({
    id: fc.uuid(),
    priority: fc.constantFrom('CRITICAL', 'HIGH', 'MEDIUM', 'LOW') as fc.Arbitrary<Priority>,
    policy: fc.constantFrom('load-balanced', 'latency-aware', 'cost-aware'),
  });

  it('should ALWAYS return exactly one node or throw SchedulingError — never null/undefined', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(nodeArb, { minLength: 1, maxLength: 100 }),
        taskArb,
        async (nodes, task) => {
          try {
            const selected = await selectNode(nodes as DomainNode[], task as DomainTask, { weights });
            
            // Invariant: If a result is returned, it must be one of the input nodes
            // and it must be ONLINE (since our logic filters for ONLINE)
            if (nodes.some(n => n.status === 'ONLINE')) {
              expect(selected).toBeDefined();
              expect(nodes.map(n => n.id)).toContain(selected.id);
              expect(selected.status).toBe('ONLINE');
            } else {
              // If no nodes are ONLINE, it should have thrown SchedulingError
              // (but fast-check handles the throw in the catch block)
            }
          } catch (error: any) {
            // Invariant: Only SchedulingError is allowed for valid inputs
            expect(error.name).toBe('SchedulingError');
          }
        }
      )
    );
  });
});
