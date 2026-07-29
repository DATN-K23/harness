import { z } from "zod";

export function toDraft7JsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, {
    target: "draft-7",
  });
}
