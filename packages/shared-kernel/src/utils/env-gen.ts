import { z } from "zod";

/**
 * Generates a string representation of an .env.example file from a Zod schema.
 */
export function generateEnvExample(schema: z.ZodObject<any>): string {
  const shape = schema.shape;
  const lines: string[] = ["# Environment Variables Example", ""];

  for (const [key, value] of Object.entries(shape)) {
    const zodValue = value as z.ZodTypeAny;
    const description = (zodValue as any)._def?.description || "";
    const defaultValue = (zodValue as any)._def?.defaultValue?.() ?? "";
    const isOptional = zodValue.isOptional();

    if (description) {
      lines.push(`# ${description}`);
    }

    let line = `${key}=`;
    if (defaultValue !== undefined && defaultValue !== "") {
      line += defaultValue;
    } else if (!isOptional) {
      line += "# REQUIRED";
    }

    lines.push(line);
  }

  return lines.join("\n");
}
