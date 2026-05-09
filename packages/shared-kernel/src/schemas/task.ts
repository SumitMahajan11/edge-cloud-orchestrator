import { z } from 'zod';

export const TaskMetadataSchema = z.record(z.string(), z.string().max(256)).superRefine((val, ctx) => {
  if (Object.keys(val).length > 20) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Metadata cannot have more than 20 keys',
    });
  }
});

const isPrimitive = (val: any) =>
  val === null ||
  typeof val === 'string' ||
  typeof val === 'number' ||
  typeof val === 'boolean';

export const TaskInputSchema = z.record(z.string(), z.any()).superRefine((val, ctx) => {
  let keyCount = 0;

  const checkDepthAndKeys = (obj: any, currentDepth: number) => {
    if (currentDepth > 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Input object exceeds maximum depth of 3',
      });
      return;
    }

    if (typeof obj !== 'object' || obj === null) {
      if (!isPrimitive(obj)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Input values must be string, number, boolean, null, or objects/arrays of these',
        });
      }
      return;
    }

    const keys = Object.keys(obj);
    keyCount += keys.length;
    if (keyCount > 50) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Input object exceeds maximum of 50 total keys',
      });
      return;
    }

    for (const key of keys) {
      checkDepthAndKeys(obj[key], currentDepth + 1);
    }
  };

  // Start with depth 0 for the root object
  checkDepthAndKeys(val, 0);
});
