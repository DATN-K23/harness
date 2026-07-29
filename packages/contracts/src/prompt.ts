import { z } from "zod";
import {
  SchemaVersionSchema,
  SemanticVersionSchema,
  Sha256Schema,
} from "./common.js";

export const PromptComponentSchema = z.strictObject({
  id: z.string().trim().min(1),
  version: SemanticVersionSchema,
  content_hash: Sha256Schema,
});

export const PromptManifestSchema = z.strictObject({
  schema_version: SchemaVersionSchema,
  components: z.array(PromptComponentSchema).min(1),
  aggregate_hash: Sha256Schema,
});

export type PromptComponent = z.infer<typeof PromptComponentSchema>;
export type PromptManifest = z.infer<typeof PromptManifestSchema>;
