import { z } from "zod";

/**
 * API V1 Task Contracts
 */

export const CreateTaskV1Schema = z
  .object({
    name: z.string().min(1).max(200),
    type: z.enum([
      "IMAGE_CLASSIFICATION",
      "DATA_AGGREGATION",
      "MODEL_INFERENCE",
      "SENSOR_FUSION",
      "VIDEO_PROCESSING",
      "LOG_ANALYSIS",
      "ANOMALY_DETECTION",
      "DATA_PROCESSING",
      "ETL_PIPELINE",
      "ML_TRAINING",
      "NLP",
      "COMPUTER_VISION",
      "SPEECH_RECOGNITION",
      "RECOMMENDATION_ENGINE",
      "FRAUD_DETECTION",
      "IOT_DATA_INGESTION",
      "REALTIME_ANALYTICS",
      "BATCH_PROCESSING",
      "CONTAINER_BUILD",
      "CICD_PIPELINE",
      "CUSTOM",
    ]),
    priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
    target: z.enum(["EDGE", "CLOUD", "HYBRID"]).default("EDGE"),
    nodeId: z.string().optional(),
    specs: z
      .object({
        cpuCores: z.number().int().min(1).max(128).optional(),
        memoryGB: z.number().int().min(1).max(1024).optional(),
        memoryMB: z
          .number()
          .int()
          .min(1)
          .max(256 * 1024)
          .optional(),
      })
      .optional(),
    input: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
    maxRetries: z.number().int().min(0).max(10).default(3),
    runtime: z.enum(["NATIVE", "DOCKER", "WASM"]).default("DOCKER"),
    image: z.string().optional(),
    wasmArtifactId: z.string().optional(),
    affinity: z.string().optional(),
    traceId: z.string().optional(),
    isDeferrable: z.boolean().optional(),
    maxDelayMinutes: z.number().int().min(0).optional(),
    policy: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.runtime === "WASM") {
      if (!data.wasmArtifactId && (!data.image || !data.image.startsWith("http"))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "WASM runtime requires either a valid URL for the image or a wasmArtifactId",
          path: ["image"],
        });
      }
    }
  });

export const UpdateTaskV1Schema = z.object({
  name: z.string().min(1).max(200).optional(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
  nodeId: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

export const TaskV1ResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.string(),
  status: z.enum([
    "PENDING",
    "SCHEDULED",
    "RUNNING",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
  ]),
  priority: z.string(),
  nodeId: z.string().optional().nullable(),
  specs: z
    .object({
      cpuCores: z.number(),
      memoryGB: z.number(),
    })
    .optional()
    .nullable(),
  submittedAt: z.string().datetime(),
  startedAt: z.string().datetime().optional().nullable(),
  completedAt: z.string().datetime().optional().nullable(),
  error: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
  runtime: z.enum(["NATIVE", "DOCKER", "WASM"]),
  image: z.string().optional().nullable(),
  wasmArtifactId: z.string().optional().nullable(),
  affinity: z.string().optional().nullable(),
  traceId: z.string().optional().nullable(),
});

export const TaskQueryV1Schema = z.object({
  status: z
    .enum([
      "PENDING",
      "SCHEDULED",
      "RUNNING",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
    ])
    .optional(),
  type: z.string().optional(),
  nodeId: z.string().optional(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(10000).default(20),
  sortBy: z
    .enum([
      "submittedAt",
      "priority",
      "status",
      "duration",
      "createdAt",
      "updatedAt",
      "name",
    ])
    .default("submittedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// Types derived from schemas
export type CreateTaskV1 = z.infer<typeof CreateTaskV1Schema>;
export type UpdateTaskV1 = z.infer<typeof UpdateTaskV1Schema>;
export type TaskV1Response = z.infer<typeof TaskV1ResponseSchema>;
export type TaskQueryV1 = z.infer<typeof TaskQueryV1Schema>;
