import {
  RunConfigSnapshotSchema,
  RunFeatureFlagsSchema,
  RunLimitsSchema,
  RunPolicySnapshotSchema,
  RunRecoveryLimitsSchema,
  type RunConfigSnapshot,
} from "@audit-harness/contracts";
import { z } from "zod";
import {
  ConfigurationError,
  ConfigurationErrorCode,
} from "./configuration-error.js";
import {
  composeJudgePrompt,
  type PromptComposition,
  type WorkspacePromptMetadata,
} from "./prompt.js";

const ModelSchema = z.strictObject({
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
});

export const DefaultsConfigSchema = z.strictObject({
  schema_version: z.literal(1),
  mode: z.literal("judge"),
  model: ModelSchema,
  output_contract_version: z.string().regex(/^\d+\.\d+\.\d+$/u),
});

export const FlagsConfigSchema = z.strictObject({
  prompt_variant: z.literal("judge-v0"),
  enabled_tool_ids: z.array(z.string().trim().min(1)),
  enabled_skill_ids: z.array(z.string().trim().min(1)),
  feature_flags: RunFeatureFlagsSchema,
});

export const RuntimeConfigSchema = z.strictObject({
  limits: RunLimitsSchema,
  recovery_limits: RunRecoveryLimitsSchema,
});

export const JudgePolicyConfigSchema = z.strictObject({
  mode: z.literal("judge"),
  policy: RunPolicySnapshotSchema,
});

const RunConfigOverrideSchema = z.strictObject({
  model: ModelSchema.partial().optional(),
  prompt_variant: z.literal("judge-v0").optional(),
  output_contract_version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/u)
    .optional(),
  enabled_tool_ids: z.array(z.string().trim().min(1)).optional(),
  enabled_skill_ids: z.array(z.string().trim().min(1)).optional(),
  feature_flags: RunFeatureFlagsSchema.partial().optional(),
  limits: RunLimitsSchema.partial().optional(),
  recovery_limits: RunRecoveryLimitsSchema.partial().optional(),
  policy: z
    .strictObject({
      workspace: RunPolicySnapshotSchema.shape.workspace.partial().optional(),
      tools: RunPolicySnapshotSchema.shape.tools.partial().optional(),
    })
    .optional(),
});

export interface RunConfigSources {
  readonly defaults: unknown;
  readonly flags: unknown;
  readonly runtime: unknown;
  readonly mode_policy: unknown;
  readonly experiment?: unknown;
  readonly override?: unknown;
}

interface ResolvedRunConfiguration {
  readonly schema_version: 1;
  readonly mode: "judge";
  readonly model: { readonly provider: string; readonly model: string };
  readonly output_contract_version: string;
  readonly prompt_variant: "judge-v0";
  readonly enabled_tool_ids: readonly string[];
  readonly enabled_skill_ids: readonly string[];
  readonly feature_flags: z.infer<typeof RunFeatureFlagsSchema>;
  readonly limits: z.infer<typeof RunLimitsSchema>;
  readonly recovery_limits: z.infer<typeof RunRecoveryLimitsSchema>;
  readonly policy: z.infer<typeof RunPolicySnapshotSchema>;
}

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type CompleteRunConfigSnapshot = RunConfigSnapshot & {
  recovery_limits: z.infer<typeof RunRecoveryLimitsSchema>;
  policy: z.infer<typeof RunPolicySnapshotSchema>;
};

export interface CreatedRunConfiguration {
  readonly resolved: DeepReadonly<ResolvedRunConfiguration>;
  readonly snapshot: DeepReadonly<CompleteRunConfigSnapshot>;
  readonly prompt: DeepReadonly<PromptComposition>;
}

function parseSource<T>(
  schema: z.ZodType<T>,
  value: unknown,
  source: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ConfigurationError(
      ConfigurationErrorCode.invalidSource,
      `Configuration source "${source}" is invalid.`,
      { source, issue_count: parsed.error.issues.length },
    );
  }
  return parsed.data;
}

function mergeOverride(
  base: ResolvedRunConfiguration,
  value: unknown,
  source: string,
): ResolvedRunConfiguration {
  if (value === undefined) {
    return base;
  }
  const override = parseSource(RunConfigOverrideSchema, value, source);
  return {
    ...base,
    model: {
      provider: override.model?.provider ?? base.model.provider,
      model: override.model?.model ?? base.model.model,
    },
    prompt_variant: override.prompt_variant ?? base.prompt_variant,
    output_contract_version:
      override.output_contract_version ?? base.output_contract_version,
    enabled_tool_ids: override.enabled_tool_ids ?? base.enabled_tool_ids,
    enabled_skill_ids: override.enabled_skill_ids ?? base.enabled_skill_ids,
    feature_flags: {
      tools: override.feature_flags?.tools ?? base.feature_flags.tools,
      skills: override.feature_flags?.skills ?? base.feature_flags.skills,
      context_compaction:
        override.feature_flags?.context_compaction ??
        base.feature_flags.context_compaction,
      session_note:
        override.feature_flags?.session_note ?? base.feature_flags.session_note,
      long_term_memory:
        override.feature_flags?.long_term_memory ??
        base.feature_flags.long_term_memory,
      verification:
        override.feature_flags?.verification ?? base.feature_flags.verification,
      retry: override.feature_flags?.retry ?? base.feature_flags.retry,
      no_progress_detection:
        override.feature_flags?.no_progress_detection ??
        base.feature_flags.no_progress_detection,
    },
    limits: {
      max_steps: override.limits?.max_steps ?? base.limits.max_steps,
      max_input_tokens:
        override.limits?.max_input_tokens ?? base.limits.max_input_tokens,
      max_output_tokens:
        override.limits?.max_output_tokens ?? base.limits.max_output_tokens,
      max_cost_usd: override.limits?.max_cost_usd ?? base.limits.max_cost_usd,
      wall_clock_timeout_ms:
        override.limits?.wall_clock_timeout_ms ??
        base.limits.wall_clock_timeout_ms,
    },
    recovery_limits: {
      max_repair_attempts:
        override.recovery_limits?.max_repair_attempts ??
        base.recovery_limits.max_repair_attempts,
    },
    policy: {
      workspace: {
        read_only:
          override.policy?.workspace?.read_only ??
          base.policy.workspace.read_only,
        relative_paths_only:
          override.policy?.workspace?.relative_paths_only ??
          base.policy.workspace.relative_paths_only,
        deny_path_traversal:
          override.policy?.workspace?.deny_path_traversal ??
          base.policy.workspace.deny_path_traversal,
        deny_symlink_escape:
          override.policy?.workspace?.deny_symlink_escape ??
          base.policy.workspace.deny_symlink_escape,
      },
      tools: {
        allowed_capabilities:
          override.policy?.tools?.allowed_capabilities ??
          base.policy.tools.allowed_capabilities,
        network_allowed:
          override.policy?.tools?.network_allowed ??
          base.policy.tools.network_allowed,
      },
    },
  };
}

export function resolveRunConfiguration(
  sources: RunConfigSources,
): ResolvedRunConfiguration {
  const defaults = parseSource(
    DefaultsConfigSchema,
    sources.defaults,
    "defaults",
  );
  const flags = parseSource(FlagsConfigSchema, sources.flags, "flags");
  const runtime = parseSource(RuntimeConfigSchema, sources.runtime, "runtime");
  const modePolicy = parseSource(
    JudgePolicyConfigSchema,
    sources.mode_policy,
    "mode_policy",
  );

  const base: ResolvedRunConfiguration = {
    ...defaults,
    ...flags,
    ...runtime,
    policy: modePolicy.policy,
  };
  const withExperiment = mergeOverride(base, sources.experiment, "experiment");
  return mergeOverride(withExperiment, sources.override, "override");
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value as DeepReadonly<T>;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value as DeepReadonly<T>;
}

export function createRunConfiguration(input: {
  readonly sources: RunConfigSources;
  readonly workspace: WorkspacePromptMetadata;
  readonly created_at: string;
}): CreatedRunConfiguration {
  const resolved = resolveRunConfiguration(input.sources);
  if (resolved.mode !== "judge") {
    throw new ConfigurationError(
      ConfigurationErrorCode.unsupportedMode,
      "Slice 1 configuration supports Judge mode only.",
    );
  }

  const prompt = composeJudgePrompt({
    prompt_variant: resolved.prompt_variant,
    output_contract_version: resolved.output_contract_version,
    workspace: input.workspace,
    enabled_skill_ids: resolved.enabled_skill_ids,
    limits: resolved.limits,
    recovery_limits: resolved.recovery_limits,
    policy: resolved.policy,
  });
  const parsed = RunConfigSnapshotSchema.safeParse({
    schema_version: resolved.schema_version,
    mode: resolved.mode,
    model: resolved.model,
    prompt_manifest: prompt.manifest,
    enabled_tool_ids: resolved.enabled_tool_ids,
    enabled_skill_ids: resolved.enabled_skill_ids,
    feature_flags: resolved.feature_flags,
    limits: resolved.limits,
    recovery_limits: resolved.recovery_limits,
    policy: resolved.policy,
    pricing_catalog_hash: null,
    created_at: input.created_at,
  });
  if (!parsed.success) {
    throw new ConfigurationError(
      ConfigurationErrorCode.invalidResolvedConfig,
      "Resolved configuration cannot create a RunConfigSnapshot.",
      { issue_count: parsed.error.issues.length },
    );
  }

  return deepFreeze({
    resolved,
    snapshot: parsed.data as CompleteRunConfigSnapshot,
    prompt,
  });
}
