import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const tenants = await prisma.tenant.findMany();
  console.log("Tenants:", JSON.stringify(tenants, null, 2));

  const nodes = await prisma.edgeNode.findMany();
  console.log("Nodes count:", nodes.length);
  const tenantIds = Array.from(new Set(nodes.map(n => n.tenantId)));
  console.log("Unique Tenant IDs on Nodes:", tenantIds);
}

run().finally(() => prisma.$disconnect());
