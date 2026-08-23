import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.edgeNode.findMany().then(console.log).finally(() => prisma.$disconnect());
