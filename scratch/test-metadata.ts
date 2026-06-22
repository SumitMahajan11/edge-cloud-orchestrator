import { PrismaClient } from "../tests/integration/client/index.js";
import { v4 as uuidv4 } from "uuid";

async function run() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: "file:./tests/tmp/test-metadata.db",
      },
    },
  });

  const { execSync } = await import("child_process");
  const path = await import("path");
  const schemaPath = path.resolve(__dirname, "../tests/integration/client/schema.prisma");
  execSync(`pnpm exec prisma db push --schema=${schemaPath} --force-reset --accept-data-loss --skip-generate`, {
    env: { ...process.env, DATABASE_URL: "file:./tests/tmp/test-metadata.db" }
  });

  const tenant = await prisma.tenant.create({
    data: {
      name: "Test Tenant",
      slug: "test-tenant",
      config: "{}",
    }
  });

  console.log("Creating task with object metadata...");
  try {
    const task = await prisma.task.create({
      data: {
        id: uuidv4(),
        name: "Test Task",
        type: "CUSTOM",
        policy: "ml-optimized",
        reason: "Test",
        target: "EDGE",
        tenantId: tenant.id,
        metadata: {
          predictedScore: 1.0,
          modelVersion: "1.0.0",
        } as any,
      }
    });
    console.log("Created task successfully:", task);
    console.log("typeof task.metadata:", typeof task.metadata);
    console.log("task.metadata value:", task.metadata);
  } catch (err: any) {
    console.error("Error creating task with object metadata:", err.message || err);
  }

  await prisma.$disconnect();
}

run().catch(console.error);
