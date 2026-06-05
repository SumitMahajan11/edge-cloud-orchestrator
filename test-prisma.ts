import { PrismaClient } from "./tests/integration/client/index.js";
import { prismaForTenant } from "./packages/shared-kernel/src/context/tenant.js";

async function test() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: "file:./test.db",
      },
    },
  });

  console.log(
    "Original prisma.certificateAuthority:",
    !!prisma.certificateAuthority,
  );
  console.log(
    "Original prisma keys:",
    Object.keys(prisma).filter((k) => !k.startsWith("_")),
  );

  const scoped = prismaForTenant(prisma);
  console.log(
    "Scoped prisma.certificateAuthority:",
    !!scoped.certificateAuthority,
  );
  console.log(
    "Scoped keys:",
    Object.keys(scoped).filter((k) => !k.startsWith("_")),
  );

  const extended = scoped.$extends({
    query: {
      async $allOperations({ model, operation, args, query }: any) {
        return query(args);
      },
    },
  });

  console.log("Original tenant.upsert:", typeof (prisma.tenant as any).upsert);
  console.log("Scoped tenant.upsert:", typeof (scoped.tenant as any).upsert);
  console.log(
    "Extended tenant.upsert:",
    typeof (extended.tenant as any).upsert,
  );
}

test().catch(console.error);
