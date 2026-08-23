import { PrismaClient } from '@prisma/client';
import { requireProdConfirm } from './require-prod-confirm';

requireProdConfirm();
const prisma = new PrismaClient();
async function main() {
  await prisma.certificateAuthority.deleteMany();
  console.log('deleted CA');
}
main().catch(console.error).finally(() => prisma.$disconnect());
