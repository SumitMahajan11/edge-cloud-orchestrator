import { PrismaClient } from "@prisma/client";

async function run() {
  const prisma = new PrismaClient();
  try {
    const tenants = await prisma.tenant.findMany();
    console.log("Tenants in DB:", tenants.length);
    console.log(tenants);

    const users = await prisma.user.findMany();
    console.log("Users in DB:", users.length);

    const nodes = await prisma.edgeNode.findMany();
    console.log("Nodes in DB:", nodes.length);
  } catch (err) {
    console.error("Error connecting to real DB:", err);
  } finally {
    await prisma.$disconnect();
  }
}
run();
