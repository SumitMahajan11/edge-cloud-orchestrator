import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContext {
  tenantId: string;
}

// Ensure singleton in monorepos/tests
const globalSymbol = Symbol.for('edgecloud.tenantContext');
if (!(global as any)[globalSymbol]) {
  (global as any)[globalSymbol] = new AsyncLocalStorage<TenantContext>();
}

export const tenantContext: AsyncLocalStorage<TenantContext> = (global as any)[globalSymbol];

/**
 * Executes a function within a tenant context.
 */
export function runWithTenantContext<T>(tenantId: string, fn: () => T): T {
  return tenantContext.run({ tenantId }, fn);
}

/**
 * Sets the tenant context for the current execution chain (useful for hooks).
 */
export function enterWithTenantContext(tenantId: string): void {
  tenantContext.enterWith({ tenantId });
}

/**
 * Gets the current tenant ID from the context.
 */
export function getTenantId(): string | undefined {
  return tenantContext.getStore()?.tenantId;
}

/**
 * Prisma Client Extension to automatically scope queries by tenantId.
 */
export function prismaForTenant(prisma: any, forcedTenantId?: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          const tenantId = forcedTenantId || getTenantId();
          
          if (!tenantId) {
            return query(args);
          }

          // List of models that are tenant-scoped
          const scopedModels = [
            'Task',
            'TaskExecution',
            'TaskLog',
            'Workflow',
            'WorkflowExecution',
            'SchedulingPolicy',
            'AlertRule',
            'Alert',
            'AuditLog',
            'SchedulingDecision',
            'TenantUser',
            'FLModel',
            'FLSession',
            'TaskCostEstimate',
            'CostRecord',
            'CarbonMetric',
            'SagaInstance',
            'EdgeNode'
          ];

          if (scopedModels.includes(model)) {
            // Add tenantId to where clause for all operations that support it
            if (['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy'].includes(operation)) {
              args.where = { ...args.where, tenantId };
            } else if (['update', 'updateMany', 'upsert', 'delete', 'deleteMany'].includes(operation)) {
              args.where = { ...args.where, tenantId };
            } else if (['create', 'createMany'].includes(operation)) {
              if (Array.isArray(args.data)) {
                args.data = args.data.map((item: any) => ({ ...item, tenantId }));
              } else {
                args.data = { ...args.data, tenantId };
              }
            }
          }

          return query(args);
        },
      },
    },
  });
}
