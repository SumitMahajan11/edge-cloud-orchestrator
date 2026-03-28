import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // Create admin user
  const adminPassword = await bcrypt.hash('admin123', 12)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@edge-cloud.io' },
    update: {},
    create: {
      email: 'admin@edge-cloud.io',
      passwordHash: adminPassword,
      name: 'System Administrator',
      role: Role.ADMIN,
      emailVerified: true,
    },
  })
  console.log('✅ Created admin user:', admin.email)

  // Create operator user
  const operatorPassword = await bcrypt.hash('operator123', 12)
  const operator = await prisma.user.upsert({
    where: { email: 'operator@edge-cloud.io' },
    update: {},
    create: {
      email: 'operator@edge-cloud.io',
      passwordHash: operatorPassword,
      name: 'System Operator',
      role: Role.OPERATOR,
      emailVerified: true,
    },
  })
  console.log('✅ Created operator user:', operator.email)

  // Create viewer user
  const viewerPassword = await bcrypt.hash('viewer123', 12)
  const viewer = await prisma.user.upsert({
    where: { email: 'viewer@edge-cloud.io' },
    update: {},
    create: {
      email: 'viewer@edge-cloud.io',
      passwordHash: viewerPassword,
      name: 'System Viewer',
      role: Role.VIEWER,
      emailVerified: true,
    },
  })
  console.log('✅ Created viewer user:', viewer.email)

  // Create sample edge nodes
  const regions = ['us-east', 'us-west', 'eu-west', 'apac-south']
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
    })
  )
  const nodes = await Promise.all(nodePromises)
  console.log(`✅ Created ${nodes.length} edge nodes`)

  // Create sample scheduling policies
  const policies = [
    { name: 'latency-aware', type: 'latency', config: { maxLatency: 100 } },
    { name: 'cost-aware', type: 'cost', config: { maxCostPerHour: 0.05 } },
    { name: 'load-balanced', type: 'load', config: { maxCpuThreshold: 80 } },
    { name: 'round-robin', type: 'round-robin', config: {} },
  ]

  for (const policy of policies) {
    await prisma.schedulingPolicy.upsert({
      where: { name: policy.name },
      update: {},
      create: policy,
    })
  }
  console.log(`✅ Created ${policies.length} scheduling policies`)

  // Create sample alert rules
  const alertRules = [
    { name: 'High CPU', metric: 'cpu', operator: '>', threshold: 90, duration: 5 },
    { name: 'High Memory', metric: 'memory', operator: '>', threshold: 90, duration: 5 },
    { name: 'High Latency', metric: 'latency', operator: '>', threshold: 100, duration: 3 },
    { name: 'Node Offline', metric: 'uptime', operator: '<', threshold: 1, duration: 1 },
  ]

  for (const rule of alertRules) {
    await prisma.alertRule.create({
      data: rule,
    })
  }
  console.log(`✅ Created ${alertRules.length} alert rules`)

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
  })
  console.log('✅ Created default webhook')

  console.log('\n🎉 Seeding complete!')
  console.log('\n📋 Default Credentials:')
  console.log('   Admin:    admin@edge-cloud.io / admin123')
  console.log('   Operator: operator@edge-cloud.io / operator123')
  console.log('   Viewer:   viewer@edge-cloud.io / viewer123')
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
