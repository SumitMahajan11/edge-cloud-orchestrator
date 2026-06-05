import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.findFirst({
    where: { email: 'admin@demo-org.com' },
  });

  if (!admin) {
    console.error('Admin user not found! Seed the database first.');
    process.exit(1);
  }

  // Delete existing edge-agent-01 node to allow re-registration
  const existingNode = await prisma.edgeNode.findUnique({
    where: { name: 'edge-agent-01' },
  });
  if (existingNode) {
    await prisma.nodePricing.deleteMany({
      where: { nodeId: existingNode.id },
    });
    await prisma.nodeCertificate.deleteMany({
      where: { nodeId: existingNode.id },
    });
    await prisma.edgeNode.delete({
      where: { id: existingNode.id },
    });
    console.log(`Deleted existing edgeNode edge-agent-01 (${existingNode.id})`);
  }

  const tokenValue = 'agent-bootstrap-token-123';
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

  await prisma.bootstrapToken.upsert({
    where: { token: tokenValue },
    update: {
      createdBy: admin.id,
      expiresAt,
      usedAt: null,
      usedBy: null,
    },
    create: {
      token: tokenValue,
      createdBy: admin.id,
      expiresAt,
    },
  });

  console.log(`Successfully upserted bootstrap token: ${tokenValue}`);
}

main()
  .catch((e) => {
    console.error('Failed to create bootstrap token:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
