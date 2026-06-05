import { AsyncLocalStorage } from "async_hooks";

export interface TenantContext {
  tenantId: string;
}

// Ensure singleton in monorepos/tests
const globalSymbol = Symbol.for("edgecloud.tenantContext");
if (!(global as any)[globalSymbol]) {
  (global as any)[globalSymbol] = new AsyncLocalStorage<TenantContext>();
}

export const tenantContext: AsyncLocalStorage<TenantContext> = (global as any)[
  globalSymbol
];

/**
 * Executes a function within a tenant context.
 */
export function runWithTenantContext<T>(tenantId: string, fn: () => T): T {
  return tenantContext.run({ tenantId }, fn);
}

export function enterWithTenantContext(tenantId: string | undefined): void {
  tenantContext.enterWith({ tenantId: tenantId as any });
}

/**
 * Gets the current tenant ID from the context.
 */
export function getTenantId(): string | undefined {
  return tenantContext.getStore()?.tenantId;
}

const jsonFields = new Set([
  "config",
  "permissions",
  "payload",
  "details",
  "input",
  "metadata",
  "context",
  "output",
  "explanation",
  "candidateNodes",
  "schedulingDecision",
  "result",
]);

function serializeJsonFields(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) {
    return obj.map(serializeJsonFields);
  }
  if (typeof obj === "object") {
    const serialized: any = {};
    for (const key of Object.keys(obj)) {
      if (
        jsonFields.has(key) &&
        obj[key] !== null &&
        obj[key] !== undefined &&
        typeof obj[key] === "object"
      ) {
        serialized[key] = JSON.stringify(obj[key]);
      } else {
        serialized[key] = serializeJsonFields(obj[key]);
      }
    }
    return serialized;
  }
  return obj;
}

function deserializeJsonFields(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) {
    return obj.map(deserializeJsonFields);
  }
  if (typeof obj === "object") {
    for (const key of Object.keys(obj)) {
      if (jsonFields.has(key) && typeof obj[key] === "string") {
        try {
          obj[key] = JSON.parse(obj[key]);
        } catch {
          // ignore parsing error, keep as string
        }
      } else {
        obj[key] = deserializeJsonFields(obj[key]);
      }
    }
    return obj;
  }
  return obj;
}

/**
 * Prisma Client Extension to automatically scope queries by tenantId.
 */
export function prismaForTenant(prisma: any, forcedTenantId?: string) {
  let extended = prisma;

  const isSqlite = process.env.DATABASE_URL?.startsWith("file:");
  if (isSqlite) {
    extended = extended.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query }: any) {
            if (args) {
              if (args.data) args.data = serializeJsonFields(args.data);
              if (args.create) args.create = serializeJsonFields(args.create);
              if (args.update) args.update = serializeJsonFields(args.update);
              if (args.where) args.where = serializeJsonFields(args.where);
            }
            const result = await query(args);
            return deserializeJsonFields(result);
          },
        },
      },
    });
  }

  return extended.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          const tenantId = forcedTenantId || getTenantId();

          if (!tenantId) {
            return query(args);
          }

          // List of models that are tenant-scoped
          const scopedModels = [
            "Task",
            "TaskExecution",
            "TaskLog",
            "Workflow",
            "WorkflowExecution",
            "SchedulingPolicy",
            "AlertRule",
            "Alert",
            "AuditLog",
            "SchedulingDecision",
            "TenantUser",
            "FLModel",
            "FLSession",
            "TaskCostEstimate",
            "CostRecord",
            "CarbonMetric",
            "SagaInstance",
            "SagaStep",
            "EdgeNode",
            "Webhook",
            "WebhookDelivery",
          ];

          if (scopedModels.includes(model)) {
            // Add tenantId to where clause for all operations that support it
            if (
              [
                "findMany",
                "findFirst",
                "findUnique",
                "count",
                "aggregate",
                "groupBy",
              ].includes(operation)
            ) {
              args.where = { ...args.where, tenantId };
            } else if (
              [
                "update",
                "updateMany",
                "upsert",
                "delete",
                "deleteMany",
              ].includes(operation)
            ) {
              args.where = { ...args.where, tenantId };
            } else if (["create", "createMany"].includes(operation)) {
              if (Array.isArray(args.data)) {
                args.data = args.data.map((item: any) => ({
                  ...item,
                  tenantId,
                }));
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
