import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL || 'postgresql://edgecloud:edgecloud_dev_password@127.0.0.1:5433/edgecloud',
      },
    },
  });
  const users = await prisma.user.findMany();
  console.log('--- USERS IN DATABASE ---');
  console.log(JSON.stringify(users, null, 2));
  await prisma.$disconnect();
}

main().catch(console.error);
