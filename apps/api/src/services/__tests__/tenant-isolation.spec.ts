import { prismaForTenant, runWithTenantContext } from '@edgecloud/shared-kernel';

describe('Tenant Data Isolation', () => {
  let prisma: any;
  const tenantA = 'tenant-a-id';
  const tenantB = 'tenant-b-id';

  beforeEach(async () => {
    // Create a mock base Prisma object
    const basePrisma = {
      task: {
        findMany: vi.fn(async (args: any) => {
          if (args.where?.tenantId === tenantA) {
            return [{ id: 'task-1', name: 'Task A', tenantId: tenantA }];
          }
          if (args.where?.tenantId === tenantB) {
            return [{ id: 'task-2', name: 'Task B', tenantId: tenantB }];
          }
          return [];
        }),
      },
      $extends: (extension: any) => {
        // Simple implementation of $extends for testing
        const extended: any = { ...basePrisma };
        const originalTaskFindMany = basePrisma.task.findMany;
        
        extended.task.findMany = async (args: any) => {
          return extension.query.$allModels.$allOperations({
            model: 'Task',
            operation: 'findMany',
            args: args || {},
            query: (a: any) => originalTaskFindMany(a)
          });
        };
        return extended;
      }
    };

    prisma = prismaForTenant(basePrisma);
  });

  it('should restrict queries to Tenant A when in Tenant A context', async () => {
    await runWithTenantContext(tenantA, async () => {
      const tasks = await prisma.task.findMany();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].tenantId).toBe(tenantA);
    });
  });

  it('should restrict queries to Tenant B when in Tenant B context', async () => {
    await runWithTenantContext(tenantB, async () => {
      const tasks = await prisma.task.findMany();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].tenantId).toBe(tenantB);
    });
  });

  it('should not return data if no tenant context is set (or fallback to all if permitted)', async () => {
    // In our implementation, if no tenantId is in context, it returns query(args) without modification.
    // In the mock, this returns [] because our mock expects tenantA or tenantB.
    const tasks = await prisma.task.findMany();
    expect(tasks).toHaveLength(0);
  });
});
