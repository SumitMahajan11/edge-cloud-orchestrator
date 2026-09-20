import { z } from "zod";

/**
 * API V1 Node Contracts
 */

export const RegisterNodeV1Schema = z.object({
  name: z.string().min(1).max(100),
  location: z.string().min(1).max(200),
  region: z.string().min(1).max(50),
  ipAddress: z.string().ip({ version: "v4" }),
  port: z.number().int().min(1).max(65535),
  cpuCores: z.number().int().min(1).max(128),
  memoryGB: z.number().int().min(1).max(1024),
  storageGB: z.number().int().min(1).max(10000),
  gpuModel: z.string().min(1).max(200).optional(),
  gpuMemoryMb: z
    .number()
    .int()
    .min(1)
    .max(1024 * 1024)
    .optional(),
  costPerHour: z.number().min(0).max(100).optional(),
  maxTasks: z.number().int().min(1).max(1000).optional(),
  bandwidthInMbps: z.number().int().min(1).optional(),
  bandwidthOutMbps: z.number().int().min(1).optional(),
});

export const UpdateNodeV1Schema = z.object({
  name: z.string().min(1).max(100).optional(),
  location: z.string().min(1).max(200).optional(),
  region: z.string().min(1).max(50).optional(),
  cpuCores: z.number().int().min(1).max(128).optional(),
  memoryGB: z.number().int().min(1).max(1024).optional(),
  storageGB: z.number().int().min(1).max(10000).optional(),
  gpuModel: z.string().min(1).max(200).nullable().optional(),
  gpuMemoryMb: z
    .number()
    .int()
    .min(1)
    .max(1024 * 1024)
    .nullable()
    .optional(),
  costPerHour: z.number().min(0).max(100).optional(),
  maxTasks: z.number().int().min(1).max(1000).optional(),
  isMaintenanceMode: z.boolean().optional(),
});

export const NodeV1ResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  location: z.string(),
  region: z.string(),
  status: z.enum(["ONLINE", "OFFLINE", "DEGRADED", "MAINTENANCE"]),
  ipAddress: z.string(),
  port: z.number(),
  specs: z.object({
    cpuCores: z.number(),
    memoryGB: z.number(),
    storageGB: z.number(),
    gpuModel: z.string().nullable().optional(),
    gpuMemoryMb: z.number().nullable().optional(),
  }),
  load: z
    .object({
      cpuUsage: z.number().optional(),
      memoryUsage: z.number().optional(),
      activeTasks: z.number(),
    })
    .optional(),
  lastHeartbeat: z.string().datetime(),
});

export const NodeQueryV1Schema = z.object({
  region: z.string().optional(),
  status: z.enum(["ONLINE", "OFFLINE", "DEGRADED", "MAINTENANCE"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum(["name", "region", "status", "createdAt"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// Types derived from schemas
export type RegisterNodeV1 = z.infer<typeof RegisterNodeV1Schema>;
export type UpdateNodeV1 = z.infer<typeof UpdateNodeV1Schema>;
export type NodeV1Response = z.infer<typeof NodeV1ResponseSchema>;
export type NodeQueryV1 = z.infer<typeof NodeQueryV1Schema>;
