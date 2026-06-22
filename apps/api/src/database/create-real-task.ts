import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { TaskScheduler } from '../services/task-scheduler';
import { logger } from '../lib/logger';

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.findFirst({
    where: { email: 'admin@demo-org.com' },
  });

  if (!admin) {
    console.error('Admin user not found! Seed the database first.');
    process.exit(1);
  }

  const tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    console.error('Tenant not found!');
    process.exit(1);
  }

  const node = await prisma.edgeNode.findFirst({
    where: { tenantId: tenant.id },
  });
  if (!node) {
    console.error('Edge Node not found! Seed the database first.');
    process.exit(1);
  }

  const nodeId = node.id;
  const taskId = 'e2e-proof-task-100';

  // Delete existing task if present to make test repeatable
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
  });
  if (existing) {
    await prisma.taskExecution.deleteMany({
      where: { taskId },
    });
    await prisma.taskLog.deleteMany({
      where: { taskId },
    });
    await prisma.task.delete({
      where: { id: taskId },
    });
    console.log(`Deleted existing task ${taskId}`);
  }

  // Create the task in PENDING state
  const task = await prisma.task.create({
    data: {
      id: taskId,
      name: 'E2E Real Infrastructure Proof Task',
      type: 'DATA_AGGREGATION',
      status: 'PENDING',
      priority: 'HIGH',
      target: 'EDGE',
      nodeId: nodeId,
      policy: 'manual',
      reason: 'E2E Real Infrastructure Proof',
      runtime: 'WASM',
      image: 'http://127.0.0.1:3090/hello.wasm',
      input: { data: 'hello from real postgres and redis infrastructure!' },
      tenantId: tenant.id,
    },
  });

  console.log(`Successfully created task ${task.id} in PENDING state assigned to node ${nodeId}`);

  // Enqueue in Redis
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6380';
  const redis = new Redis(redisUrl);
  await redis.zadd('task:queue', 10, task.id);
  console.log('Task enqueued to Redis');
  
  // Directly process queue
  const wsManager = {
    broadcastToTenant: () => {},
    broadcast: () => {},
  } as any;
  const scheduler = new TaskScheduler(prisma, redis, wsManager, logger);
  (scheduler as any).isRunning = true;
  (scheduler as any).leaderElection = {
    isCurrentlyLeader: () => true,
    start: async () => {},
    stop: async () => {},
  } as any;
  
  // Keep nodes online
  await prisma.edgeNode.updateMany({
    data: {
      status: 'ONLINE',
      lastHeartbeat: new Date(),
    },
  });

  await scheduler.processQueue();
  console.log('Scheduler processQueue finished');
  
  await redis.quit();
}

main()
  .catch((e) => {
    console.error('Failed to create task:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
