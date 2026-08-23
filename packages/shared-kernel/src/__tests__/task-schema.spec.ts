import { describe, it, expect } from "vitest";
import { TaskInputSchema, TaskMetadataSchema } from "../schemas/task";

describe("Task Schemas", () => {
  describe("TaskInputSchema", () => {
    it("a. Valid payload passes validation", () => {
      const validPayload = {
        key1: "value",
        key2: 123,
        key3: true,
        key4: null,
        key5: {
          subKey1: "subValue",
          subKey2: {
            deepKey: "deepValue",
          },
        },
      };

      const result = TaskInputSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("b. Deeply nested object (depth > 3) is rejected with a clear error", () => {
      const deepPayload = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: "too deep",
              },
            },
          },
        },
      };

      const result = TaskInputSchema.safeParse(deepPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe(
          "Input object exceeds maximum depth of 3",
        );
      }
    });

    it("should reject objects with more than 50 keys", () => {
      const largePayload: Record<string, string> = {};
      for (let i = 0; i < 51; i++) {
        largePayload[`key${i}`] = "value";
      }

      const result = TaskInputSchema.safeParse(largePayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe(
          "Input object exceeds maximum of 50 total keys",
        );
      }
    });

    it("should reject non-primitive leaf values like functions", () => {
      const payload = {
        key: () => {},
      };

      const result = TaskInputSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe(
          "Input values must be string, number, boolean, null, or objects/arrays of these",
        );
      }
    });
  });

  describe("TaskMetadataSchema", () => {
    it("a. Valid payload passes validation", () => {
      const validPayload = {
        meta1: "value1",
        meta2: "value2",
      };

      const result = TaskMetadataSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("c. Non-string value in metadata is rejected with a clear error", () => {
      const invalidPayload = {
        meta1: "value",
        meta2: 123, // Invalid: must be string
      };

      const result = TaskMetadataSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("Expected string");
      }
    });

    it("should reject metadata with more than 20 keys", () => {
      const largePayload: Record<string, string> = {};
      for (let i = 0; i < 21; i++) {
        largePayload[`key${i}`] = "value";
      }

      const result = TaskMetadataSchema.safeParse(largePayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe(
          "Metadata cannot have more than 20 keys",
        );
      }
    });

    it("should reject metadata with values exceeding 256 characters", () => {
      const payload = {
        key: "a".repeat(257),
      };

      const result = TaskMetadataSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });
});
