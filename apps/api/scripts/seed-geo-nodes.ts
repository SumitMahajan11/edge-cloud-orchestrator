import { PrismaClient } from '@prisma/client';
import { requireProdConfirm } from '../../../scripts/require-prod-confirm';

requireProdConfirm();
const prisma = new PrismaClient();

async function main() {
  const tenantId = '68c7e6c3-1f1d-4f1d-8f1d-1f1d1f1d1f1d'; // Standard tenant ID from common-tenant.ts if it exists

  // Try to find a tenant
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    console.error('No tenant found. Run migrations and seed first.');
    return;
  }

  const nodes = [
    {
      name: 'Edge-NYC-01',
      region: 'us-east',
      latitude: 40.7128,
      longitude: -74.006,
    },
    {
      name: 'Edge-SFO-01',
      region: 'us-west',
      latitude: 37.7749,
      longitude: -122.4194,
    },
    {
      name: 'Edge-LON-01',
      region: 'eu-west',
      latitude: 51.5074,
      longitude: -0.1278,
    },
    {
      name: 'Edge-FRA-01',
      region: 'eu-central',
      latitude: 50.1109,
      longitude: 8.6821,
    },
    {
      name: 'Edge-SGP-01',
      region: 'apac-south',
      latitude: 1.3521,
      longitude: 103.8198,
    },
  ];

  for (const n of nodes) {
    await prisma.edgeNode.upsert({
      where: { id: `node-${n.name.toLowerCase()}` },
      update: {
        latitude: n.latitude,
        longitude: n.longitude,
        status: 'ONLINE',
      },
      create: {
        id: `node-${n.name.toLowerCase()}`,
        name: n.name,
        region: n.region,
        location: n.name.split('-')[1],
        latitude: n.latitude,
        longitude: n.longitude,
        status: 'ONLINE',
        tenantId: tenant.id,
        cpu: 0,
        memory: 0,
        storage: 0,
        uptime: 0,
        lastHeartbeat: new Date(),
      },
    });
  }

  console.log('Seeded 5 nodes with coordinates.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
