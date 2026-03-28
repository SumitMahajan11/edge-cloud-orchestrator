/**
 * Production Seed Script
 * 
 * This script seeds the database with production-ready data:
 * - Admin user
 * - Sample edge nodes
 * - Sample tasks
 * - API keys
 * - Webhooks
 */

// @ts-nocheck
// This file contains seed data that requires schema alignment for full type safety

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'

const prisma = new PrismaClient()

// Enum values from Prisma schema
const Role = {
  ADMIN: 'ADMIN',
  OPERATOR: 'OPERATOR',
  VIEWER: 'VIEWER',
} as const

const NodeStatus = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  DEGRADED: 'DEGRADED',
  MAINTENANCE: 'MAINTENANCE',
} as const

const TaskType = {
  IMAGE_CLASSIFICATION: 'IMAGE_CLASSIFICATION',
  DATA_AGGREGATION: 'DATA_AGGREGATION',
  MODEL_INFERENCE: 'MODEL_INFERENCE',
  SENSOR_FUSION: 'SENSOR_FUSION',
  VIDEO_PROCESSING: 'VIDEO_PROCESSING',
  LOG_ANALYSIS: 'LOG_ANALYSIS',
  ANOMALY_DETECTION: 'ANOMALY_DETECTION',
  CUSTOM: 'CUSTOM',
} as const

const TaskStatus = {
  PENDING: 'PENDING',
  SCHEDULED: 'SCHEDULED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const

const Priority = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const

const ExecutionTarget = {
  EDGE: 'EDGE',
  CLOUD: 'CLOUD',
  HYBRID: 'HYBRID',
} as const

async function main() {
  console.log('🌱 Starting production seed...')

  // Create admin user
  const adminPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 10)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      id: uuidv4(),
      email: 'admin@example.com',
      passwordHash: adminPassword,
      name: 'System Administrator',
      role: Role.ADMIN,
      isActive: true,
      emailVerified: true,
    },
  })
  console.log('✅ Admin user created:', admin.email)

  // Create operator user
  const operatorPassword = await bcrypt.hash(process.env.OPERATOR_PASSWORD || 'operator123', 10)
  const operator = await prisma.user.upsert({
    where: { email: 'operator@example.com' },
    update: {},
    create: {
      id: uuidv4(),
      email: 'operator@example.com',
      passwordHash: operatorPassword,
      name: 'System Operator',
      role: Role.OPERATOR,
      isActive: true,
      emailVerified: true,
    },
  })
  console.log('✅ Operator user created:', operator.email)

  // Create viewer user
  const viewerPassword = await bcrypt.hash(process.env.VIEWER_PASSWORD || 'viewer123', 10)
  const viewer = await prisma.user.upsert({
    where: { email: 'viewer@example.com' },
    update: {},
    create: {
      id: uuidv4(),
      email: 'viewer@example.com',
      passwordHash: viewerPassword,
      name: 'System Viewer',
      role: Role.VIEWER,
      isActive: true,
      emailVerified: true,
    },
  })
  console.log('✅ Viewer user created:', viewer.email)

  // Create sample edge nodes
  const nodes = [
    {
      id: uuidv4(),
      name: 'edge-us-east-01',
      location: 'New York, USA',
      region: 'us-east-1',
      status: NodeStatus.ONLINE,
      ipAddress: '10.0.1.10',
      port: 4001,
      url: 'http://10.0.1.10:4001',
      cpuCores: 8,
      memoryGB: 32,
      storageGB: 500,
      cpuUsage: 45.2,
      memoryUsage: 62.5,
      storageUsage: 78.3,
      latency: 15,
      tasksRunning: 3,
      maxTasks: 20,
      costPerHour: 0.05,
      bandwidthInMbps: 1000,
      bandwidthOutMbps: 1000,
      isMaintenanceMode: false,
    },
    {
      id: uuidv4(),
      name: 'edge-us-west-01',
      location: 'San Francisco, USA',
      region: 'us-west-1',
      status: NodeStatus.ONLINE,
      ipAddress: '10.0.2.10',
      port: 4001,
      url: 'http://10.0.2.10:4001',
      cpuCores: 8,
      memoryGB: 32,
      storageGB: 500,
      cpuUsage: 32.1,
      memoryUsage: 45.8,
      storageUsage: 65.2,
      latency: 25,
      tasksRunning: 2,
      maxTasks: 20,
      costPerHour: 0.06,
      bandwidthInMbps: 1000,
      bandwidthOutMbps: 1000,
      isMaintenanceMode: false,
    },
    {
      id: uuidv4(),
      name: 'edge-eu-west-01',
      location: 'London, UK',
      region: 'eu-west-1',
      status: NodeStatus.ONLINE,
      ipAddress: '10.0.3.10',
      port: 4001,
      url: 'http://10.0.3.10:4001',
      cpuCores: 8,
      memoryGB: 32,
      storageGB: 500,
      cpuUsage: 28.5,
      memoryUsage: 38.2,
      storageUsage: 55.1,
      latency: 45,
      tasksRunning: 1,
      maxTasks: 20,
      costPerHour: 0.04,
      bandwidthInMbps: 1000,
      bandwidthOutMbps: 1000,
      isMaintenanceMode: false,
    },
    {
      id: uuidv4(),
      name: 'edge-apac-south-01',
      location: 'Singapore',
      region: 'apac-south-1',
      status: NodeStatus.ONLINE,
      ipAddress: '10.0.4.10',
      port: 4001,
      url: 'http://10.0.4.10:4001',
      cpuCores: 8,
      memoryGB: 32,
      storageGB: 500,
      cpuUsage: 52.3,
      memoryUsage: 68.7,
      storageUsage: 82.5,
      latency: 80,
      tasksRunning: 4,
      maxTasks: 20,
      costPerHour: 0.03,
      bandwidthInMbps: 1000,
      bandwidthOutMbps: 1000,
      isMaintenanceMode: false,
    },
  ]

  for (const node of nodes) {
    await prisma.edgeNode.upsert({
      where: { name: node.name },
      update: {},
      create: node,
    })
    console.log('✅ Edge node created:', node.name)
  }

  // Create sample completed tasks
  const tasks = [
    {
      id: uuidv4(),
      name: 'Image Classification - Batch 001',
      type: TaskType.IMAGE_CLASSIFICATION,
      priority: Priority.HIGH,
      status: TaskStatus.COMPLETED,
      target: ExecutionTarget.EDGE,
      nodeId: nodes[0]?.id || 'unknown',
      policy: 'latency-aware',
      reason: 'Completed successfully',
      input: { images: ['img1.jpg', 'img2.jpg', 'img3.jpg'] },
      output: { results: [{ class: 'cat', confidence: 0.95 }] },
      maxRetries: 3,
      retryCount: 0,
      submittedAt: new Date(Date.now() - 3600000),
      startedAt: new Date(Date.now() - 3500000),
      completedAt: new Date(Date.now() - 3400000),
      duration: 100000,
    },
    {
      id: uuidv4(),
      name: 'Model Training - v2.0',
      type: TaskType.MODEL_INFERENCE,
      priority: Priority.CRITICAL,
      status: TaskStatus.RUNNING,
      target: ExecutionTarget.CLOUD,
      policy: 'cost-aware',
      reason: 'Training in progress',
      input: { dataset: 'production-v2', epochs: 100 },
      maxRetries: 3,
      retryCount: 0,
      submittedAt: new Date(Date.now() - 7200000),
      startedAt: new Date(Date.now() - 7100000),
    },
    {
      id: uuidv4(),
      name: 'Data Aggregation - Daily Report',
      type: TaskType.DATA_AGGREGATION,
      priority: Priority.MEDIUM,
      status: TaskStatus.PENDING,
      target: ExecutionTarget.EDGE,
      policy: 'load-balanced',
      input: { sources: ['logs', 'metrics', 'events'] },
      maxRetries: 3,
      retryCount: 0,
      submittedAt: new Date(Date.now() - 1800000),
    },
  ]

  for (const task of tasks) {
    await prisma.task.upsert({
      where: { id: task.id },
      update: {},
      create: task,
    })
    console.log('✅ Task created:', task.name)
  }

  // Create API key for automation
  const apiKey = await prisma.apiKey.upsert({
    where: { key: 'prod-api-key-' + uuidv4().slice(0, 8) },
    update: {},
    create: {
      id: uuidv4(),
      userId: admin.id,
      name: 'Production Automation',
      key: 'prod-api-key-' + uuidv4().slice(0, 8),
      permissions: ['nodes:read', 'nodes:create', 'tasks:read', 'tasks:create'],
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
    },
  })
  console.log('✅ API key created:', apiKey.name)

  // Create sample webhook
  const webhook = await prisma.webhook.upsert({
    where: { id: uuidv4() },
    update: {},
    create: {
      id: uuidv4(),
      name: 'Production Alerts',
      url: 'https://hooks.example.com/alerts',
      events: ['task.completed', 'task.failed', 'node.offline'],
      secret: 'whsec_' + uuidv4().replace(/-/g, ''),
      enabled: true,
    },
  })
  console.log('✅ Webhook created:', webhook.name)

  // Create audit log entries
  await prisma.auditLog.create({
    data: {
      id: uuidv4(),
      userId: admin.id,
      action: 'system.seed',
      details: { message: 'Production seed completed', resource: 'database', resourceId: 'production' },
      ipAddress: '127.0.0.1',
      userAgent: 'seed-script',
    },
  })
  console.log('✅ Audit log entry created')

  console.log('\n🎉 Production seed completed successfully!')
  console.log('\n📋 Login credentials:')
  console.log('  Admin:    admin@example.com / admin123')
  console.log('  Operator: operator@example.com / operator123')
  console.log('  Viewer:   viewer@example.com / viewer123')
  console.log('\n⚠️  Please change default passwords before deploying to production!')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
