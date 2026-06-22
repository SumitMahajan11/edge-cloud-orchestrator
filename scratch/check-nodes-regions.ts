import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const nodes = await prisma.edgeNode.findMany();
  console.log("Total Nodes in DB:", nodes.length);
  console.log("Nodes:", nodes.map(n => ({
    id: n.id,
    name: n.name,
    region: n.region,
    status: n.status,
    tasksRunning: n.tasksRunning,
    maxTasks: n.maxTasks,
  })));
}

run()
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());
