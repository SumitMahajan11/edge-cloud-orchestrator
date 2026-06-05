import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const nodes = await prisma.edgeNode.findMany();
  console.log('--- EDGE NODES ---');
  console.dir(nodes, { depth: null });

  const tasks = await prisma.task.findMany({
    take: 5,
    orderBy: { submittedAt: 'desc' },
  });
  console.log('--- RECENT TASKS ---');
  console.dir(tasks, { depth: null });
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
