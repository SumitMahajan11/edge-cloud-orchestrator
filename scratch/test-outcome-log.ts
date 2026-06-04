
import { setupTestApp, teardownTestApp } from '../tests/integration/helpers';
import { v4 as uuidv4 } from 'uuid';

async function test() {
  const ctx = await setupTestApp();
  try {
    const task = { id: uuidv4() };
    const node = { id: uuidv4() };
    
    console.log('Creating outcome...');
    await (ctx.prisma as any).outcomeLog.create({
      data: {
        taskId: task.id,
        nodeId: node.id,
        tenantId: 'tenant-1',
        predictedLatency: 100,
        actualLatency: 120,
        predictedCpuUsage: 0.5,
        actualCpuUsage: 0.6,
        predictedMemoryUsage: 0.4,
        actualMemoryUsage: 0.5,
        outcome: 'SUCCESS'
      }
    });
    
    console.log('Querying outcome...');
    const outcomes = await (ctx.prisma as any).outcomeLog.findMany({
      where: { taskId: task.id }
    });
    
    console.log('Found outcomes:', outcomes.length);
    if (outcomes.length > 0) {
      console.log('Outcome matches:', outcomes[0].taskId === task.id);
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await teardownTestApp(ctx);
  }
}

test();
