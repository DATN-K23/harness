import { z } from "zod";
import {
  FindingIdSchema,
  RunIdSchema,
  SchemaVersionSchema,
  Sha256Schema,
  TimestampSchema,
} from "./common.js";
import { PromptManifestSchema } from "./prompt.js";
import { ToolCapabilitySchema } from "./tool.js";

export const RunModeSchema = z.enum(["judge", "audit"]);

export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_tool",
  "verifying",
  "completed",
  "failed",
  "cancelled",
]);

export const StopReasonSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("max_steps"),
    limit: z.number().int().positive(),
    observed_steps: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("timeout"),
    timeout_ms: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal("cancellation"),
    source: z.enum(["user", "system"]),
    reason: z.string().trim().min(1),
  }),
  z.strictObject({
    kind: z.literal("internal_failure"),
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
  }),
]);

export const ModelReferenceSchema = z.strictObject({
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
});

export const RunFeatureFlagsSchema = z.strictObject({
  tools: z.boolean(),
  skills: z.boolean(),
  context_compaction: z.boolean(),
  session_note: z.boolean(),
  long_term_memory: z.boolean(),
  verification: z.boolean(),
  retry: z.boolean(),
  no_progress_detection: z.boolean(),
});

export const RunLimitsSchema = z.strictObject({
  max_steps: z.number().int().positive(),
  max_input_tokens: z.number().int().positive(),
  max_output_tokens: z.number().int().positive(),
  max_cost_usd: z.number().nonnegative(),
  wall_clock_timeout_ms: z.number().int().positive(),
});

export const RunRecoveryLimitsSchema = z.strictObject({
  max_repair_attempts: z.number().int().nonnegative(),
});

export const RunPolicySnapshotSchema = z.strictObject({
  workspace: z.strictObject({
    read_only: z.boolean(),
    relative_paths_only: z.boolean(),
    deny_path_traversal: z.boolean(),
    deny_symlink_escape: z.boolean(),
  }),
  tools: z.strictObject({
    allowed_capabilities: z.array(ToolCapabilitySchema),
    network_allowed: z.boolean(),
  }),
});

export const RunConfigSnapshotSchema = z.strictObject({
  schema_version: SchemaVersionSchema,
  mode: RunModeSchema,
  model: ModelReferenceSchema,
  prompt_manifest: PromptManifestSchema,
  enabled_tool_ids: z.array(z.string().trim().min(1)),
  enabled_skill_ids: z.array(z.string().trim().min(1)),
  feature_flags: RunFeatureFlagsSchema,
  limits: RunLimitsSchema,
  recovery_limits: RunRecoveryLimitsSchema.optional(),
  policy: RunPolicySnapshotSchema.optional(),
  pricing_catalog_hash: Sha256Schema.nullable(),
  created_at: TimestampSchema,
});

export const RunSchema = z.strictObject({
  schema_version: SchemaVersionSchema,
  run_id: RunIdSchema,
  parent_run_id: RunIdSchema.nullable(),
  finding_id: FindingIdSchema.nullable(),
  mode: RunModeSchema,
  status: RunStatusSchema,
  config_snapshot: RunConfigSnapshotSchema,
  created_at: TimestampSchema,
  started_at: TimestampSchema.nullable(),
  completed_at: TimestampSchema.nullable(),
});

export type RunMode = z.infer<typeof RunModeSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type StopReason = z.infer<typeof StopReasonSchema>;
export type ModelReference = z.infer<typeof ModelReferenceSchema>;
export type RunFeatureFlags = z.infer<typeof RunFeatureFlagsSchema>;
export type RunLimits = z.infer<typeof RunLimitsSchema>;
export type RunRecoveryLimits = z.infer<typeof RunRecoveryLimitsSchema>;
export type RunPolicySnapshot = z.infer<typeof RunPolicySnapshotSchema>;
export type RunConfigSnapshot = z.infer<typeof RunConfigSnapshotSchema>;
export type Run = z.infer<typeof RunSchema>;
