import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL || 'postgresql://edgecloud:edgecloud_dev_password@127.0.0.1:5433/edgecloud',
      },
    },
  });
  const nodes = await prisma.edgeNode.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      ipAddress: true,
      cpuCores: true,
      memoryGB: true,
      lastHeartbeat: true,
    }
  });
  console.log('--- EDGE NODES IN DATABASE ---');
  console.log(JSON.stringify(nodes, null, 2));
  await prisma.$disconnect();
}

main().catch(console.error);
