import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const nodes = await prisma.edgeNode.findMany();
  console.log("Nodes count:", nodes.length);
  for (const node of nodes) {
    console.log(`- ID: ${node.id}, Name: ${node.name}, Status: ${node.status}, Region: ${node.region}, tenantId: ${node.tenantId}`);
  }

  const tenants = await prisma.tenant.findMany();
  console.log("Tenants:", tenants);

  const tasks = await prisma.task.findMany();
  console.log("Tasks count:", tasks.length);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
