import {
  PrismaClient,
  Role,
  TaskStatus,
  NodeStatus,
  ExecutionTarget,
  Runtime,
  TaskType,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

import { seedLogger as logger } from '../lib/logger';
import { env } from '../config/env';

const prisma = new PrismaClient();

async function main() {
  logger.info('Seeding database with idempotent logic...');

  // Environment-based credentials with secure defaults
  if (env.NODE_ENV === 'production' && !env.SEED_ADMIN_PASSWORD) {
    throw new Error('SEED_ADMIN_PASSWORD is required in production environment');
  }
  const ADMIN_PASSWORD = env.SEED_ADMIN_PASSWORD || 'Admin123!';
  const DEFAULT_PASSWORD = 'Password123!';

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
  const adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  // 1. Create Tenants
  const tenants = [
    { name: 'Demo Organization', slug: 'demo-org' },
    { name: 'Test Organization', slug: 'test-org' },
  ];

  const createdTenants = [];
  for (const t of tenants) {
    const tenant = await prisma.tenant.upsert({
      where: { slug: t.slug },
      update: {},
      create: {
        name: t.name,
        slug: t.slug,
        config: {},
      },
    });
    createdTenants.push(tenant);
    logger.info({ slug: t.slug }, 'Tenant verified');
  }

  // 2. Create Users
  for (const tenant of createdTenants) {
    // Admin for each tenant
    const adminEmail = `admin@${tenant.slug}.com`;
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        email: adminEmail,
        passwordHash: adminPasswordHash,
        name: `${tenant.name} Admin`,
        role: Role.ADMIN,
        emailVerified: true,
        tenantUsers: {
          create: {
            tenantId: tenant.id,
            role: 'ADMIN',
          },
        },
      },
    });

    // 2 Regular users per tenant
    for (let i = 1; i <= 2; i++) {
      const userEmail = `user${i}@${tenant.slug}.com`;
      await prisma.user.upsert({
        where: { email: userEmail },
        update: {},
        create: {
          email: userEmail,
          passwordHash: passwordHash,
          name: `User ${i} (${tenant.name})`,
          role: Role.OPERATOR,
          emailVerified: true,
          tenantUsers: {
            create: {
              tenantId: tenant.id,
              role: 'OPERATOR',
            },
          },
        },
      });
    }
  }
  logger.info('Users verified for all tenants');

  // 3. Create Edge Nodes (10 nodes)
  const regions = ['us-east', 'us-west', 'eu-central', 'asia-east'];
  for (let i = 1; i <= 10; i++) {
    const region = regions[i % regions.length];
    const nodeName = `edge-node-${String(i).padStart(3, '0')}`;
    await prisma.edgeNode.upsert({
      where: { name: nodeName },
      update: { status: NodeStatus.ONLINE },
      create: {
        name: nodeName,
        location: `Datacenter ${region.toUpperCase()}-${i}`,
        region: region,
        status: NodeStatus.ONLINE,
        ipAddress: `192.168.1.${100 + i}`,
        port: 4000 + i,
        url: `http://192.168.1.${100 + i}:${4000 + i}`,
        cpuCores: i % 2 === 0 ? 8 : 4,
        memoryGB: i % 2 === 0 ? 32 : 16,
        storageGB: 500,
        tenantId: createdTenants[0].id, // Assign most to demo-org
        costPerHour: 0.05,
        maxTasks: 20,
      },
    });
  }
  logger.info('10 Edge nodes verified');

  // 4. Create Sample Tasks (5 tasks)
  const taskSpecs = [
    {
      name: 'Image Classification Worker',
      status: TaskStatus.RUNNING,
      type: TaskType.IMAGE_CLASSIFICATION,
    },
    {
      name: 'Data Aggregator Nightly',
      status: TaskStatus.PENDING,
      type: TaskType.DATA_AGGREGATION,
    },
    {
      name: 'Anomaly Detection Stream',
      status: TaskStatus.COMPLETED,
      type: TaskType.ANOMALY_DETECTION,
    },
    {
      name: 'Batch Log Processor',
      status: TaskStatus.FAILED,
      type: TaskType.LOG_ANALYSIS,
    },
    {
      name: 'Custom Edge Script',
      status: TaskStatus.PENDING,
      type: TaskType.CUSTOM,
    },
  ];

  const dbNodes = await prisma.edgeNode.findMany({
    where: { tenantId: createdTenants[0].id },
  });

  for (let i = 0; i < taskSpecs.length; i++) {
    const spec = taskSpecs[i];
    const existing = await prisma.task.findFirst({
      where: { name: spec.name, tenantId: createdTenants[0].id },
    });

    const assignedNode = ['RUNNING', 'COMPLETED', 'FAILED'].includes(spec.status)
      ? dbNodes[i % dbNodes.length]
      : null;

    const taskData = {
      name: spec.name,
      status: spec.status,
      type: spec.type,
      priority: 'MEDIUM' as const,
      target: ExecutionTarget.EDGE,
      policy: 'latency-aware',
      reason: 'Initial seed',
      runtime: Runtime.DOCKER,
      image: 'edgecloud/worker:latest',
      tenantId: createdTenants[0].id,
      nodeId: assignedNode ? assignedNode.id : null,
      metadata: {
        specs: {
          cpuCores: (i % 3) + 1,
          memoryGB: ((i % 3) + 1) * 2,
        },
      },
    };

    if (!existing) {
      await prisma.task.create({
        data: taskData,
      });
    } else {
      await prisma.task.update({
        where: { id: existing.id },
        data: {
          nodeId: taskData.nodeId,
          metadata: taskData.metadata,
        },
      });
    }
  }
  logger.info('5 Sample tasks verified');

  // 5. Sample Webhook
  await prisma.webhook.upsert({
    where: { id: 'dev-webhook' },
    update: {},
    create: {
      id: 'dev-webhook',
      name: 'Local Mock Receiver',
      url: 'http://localhost:9000/webhook',
      events: ['task.completed', 'task.failed'],
      enabled: true,
      tenantId: createdTenants[0].id,
    },
  });
  logger.info('Sample webhook verified');

  // 6. Pre-trained ML model placeholder
  const modelDir = path.join(process.cwd(), 'models', 'scheduler');
  const modelPath = path.join(modelDir, 'model.json');
  if (!fs.existsSync(modelDir)) {
    fs.mkdirSync(modelDir, { recursive: true });
  }
  if (!fs.existsSync(modelPath)) {
    const dummyModel = {
      format: 'layers-model',
      generatedBy: 'seed-script',
      convertedBy: null,
      modelTopology: {
        training_config: {},
        model_config: { class_name: 'Sequential', config: { layers: [] } },
      },
      weightsManifest: [],
    };
    fs.writeFileSync(modelPath, JSON.stringify(dummyModel, null, 2));
    logger.info({ path: modelPath }, 'Created dummy ML model for scheduler');
  }

  logger.info('Seeding complete successfully');
}

main()
  .catch((e) => {
    logger.error({ err: e }, 'Seeding failed');
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
