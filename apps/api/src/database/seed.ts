import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { seedLogger as logger } from '../lib/logger';

const prisma = new PrismaClient();

async function main() {
  logger.info('Seeding database...');

  // Environment-based credentials with secure defaults
  const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
  const OPERATOR_PASSWORD = process.env.SEED_OPERATOR_PASSWORD;
  const VIEWER_PASSWORD = process.env.SEED_VIEWER_PASSWORD;

  if (!ADMIN_PASSWORD || !OPERATOR_PASSWORD || !VIEWER_PASSWORD) {
    logger.warn(
      'Seed passwords not fully provided in environment. Some users will have random passwords.',
    );
  }

  // Create admin user
  const adminPasswordHash = await bcrypt.hash(
    ADMIN_PASSWORD || Math.random().toString(36),
    12,
  );
  const admin = await prisma.user.upsert({
    where: { email: process.env.SEED_ADMIN_EMAIL || 'admin@edge-cloud.io' },
    update: {},
    create: {
      email: process.env.SEED_ADMIN_EMAIL || 'admin@edge-cloud.io',
      passwordHash: adminPasswordHash,
      name: 'System Administrator',
      role: Role.ADMIN,
      emailVerified: true,
    },
  });
  logger.info({ email: admin.email }, 'Created admin user');

  // Create operator user
  const operatorPasswordHash = await bcrypt.hash(
    OPERATOR_PASSWORD || Math.random().toString(36),
    12,
  );
  const operator = await prisma.user.upsert({
    where: {
      email: process.env.SEED_OPERATOR_EMAIL || 'operator@edge-cloud.io',
    },
    update: {},
    create: {
      email: process.env.SEED_OPERATOR_EMAIL || 'operator@edge-cloud.io',
      passwordHash: operatorPasswordHash,
      name: 'System Operator',
      role: Role.OPERATOR,
      emailVerified: true,
    },
  });
  logger.info({ email: operator.email }, 'Created operator user');

  // Create viewer user
  const viewerPasswordHash = await bcrypt.hash(
    VIEWER_PASSWORD || Math.random().toString(36),
    12,
  );
  const viewer = await prisma.user.upsert({
    where: { email: process.env.SEED_VIEWER_EMAIL || 'viewer@edge-cloud.io' },
    update: {},
    create: {
      email: process.env.SEED_VIEWER_EMAIL || 'viewer@edge-cloud.io',
      passwordHash: viewerPasswordHash,
      name: 'System Viewer',
      role: Role.VIEWER,
      emailVerified: true,
    },
  });
  logger.info({ email: viewer.email }, 'Created viewer user');

  // Create sample edge nodes
  const regions = ['us-east', 'us-west', 'eu-west', 'apac-south'];
  const nodePromises = regions.map((region, i) =>
    prisma.edgeNode.upsert({
      where: { name: `edge-${region}-${String(i + 1).padStart(2, '0')}` },
      update: {},
      create: {
        name: `edge-${region}-${String(i + 1).padStart(2, '0')}`,
        location: `${region}-datacenter`,
        region,
        status: 'ONLINE',
        ipAddress: `10.0.${i}.1`,
        port: 4001 + i,
        url: `http://10.0.${i}.1:${4001 + i}`,
        cpuCores: 8,
        memoryGB: 32,
        storageGB: 500,
        cpuUsage: 20 + Math.random() * 30,
        memoryUsage: 30 + Math.random() * 20,
        storageUsage: 40 + Math.random() * 20,
        latency: 10 + Math.random() * 50,
        costPerHour: 0.03 + Math.random() * 0.02,
        maxTasks: 10,
        bandwidthInMbps: 1000,
        bandwidthOutMbps: 500,
      },
    }),
  );
  const nodes = await Promise.all(nodePromises);
  logger.info({ count: nodes.length }, 'Created edge nodes');

  // Create sample scheduling policies
  const policies = [
    { name: 'latency-aware', type: 'latency', config: { maxLatency: 100 } },
    { name: 'cost-aware', type: 'cost', config: { maxCostPerHour: 0.05 } },
    { name: 'load-balanced', type: 'load', config: { maxCpuThreshold: 80 } },
    { name: 'round-robin', type: 'round-robin', config: {} },
  ];

  for (const policy of policies) {
    await prisma.schedulingPolicy.upsert({
      where: { name: policy.name },
      update: {},
      create: policy,
    });
  }
  logger.info({ count: policies.length }, 'Created scheduling policies');

  // Create sample alert rules
  const alertRules = [
    {
      name: 'High CPU',
      metric: 'cpu',
      operator: '>',
      threshold: 90,
      duration: 5,
    },
    {
      name: 'High Memory',
      metric: 'memory',
      operator: '>',
      threshold: 90,
      duration: 5,
    },
    {
      name: 'High Latency',
      metric: 'latency',
      operator: '>',
      threshold: 100,
      duration: 3,
    },
    {
      name: 'Node Offline',
      metric: 'uptime',
      operator: '<',
      threshold: 1,
      duration: 1,
    },
  ];

  for (const rule of alertRules) {
    const existing = await prisma.alertRule.findFirst({
      where: { name: rule.name },
    });
    if (!existing) {
      await prisma.alertRule.create({ data: rule });
    }
  }
  logger.info({ count: alertRules.length }, 'Created alert rules');

  // Create sample webhook
  await prisma.webhook.upsert({
    where: { id: 'default-webhook' },
    update: {},
    create: {
      id: 'default-webhook',
      name: 'Default Notification Webhook',
      url: 'https://example.com/webhook',
      events: ['task.completed', 'task.failed', 'node.offline'],
      enabled: false,
    },
  });
  logger.info('Created default webhook');

  logger.info('Seeding complete');
}

main()
  .catch((e) => {
    logger.error({ err: e }, 'Seeding failed');
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
