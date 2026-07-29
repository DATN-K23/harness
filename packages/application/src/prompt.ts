import { createHash } from "node:crypto";
import {
  PromptManifestSchema,
  type PromptManifest,
  type RunLimits,
  type ToolCapability,
} from "@audit-harness/contracts";
import { z } from "zod";
import {
  ConfigurationError,
  ConfigurationErrorCode,
} from "./configuration-error.js";

const PromptComponentInputSchema = z.strictObject({
  id: z.string().trim().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  content: z.string().min(1),
});

export const WorkspacePromptMetadataSchema = z.strictObject({
  source_label: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]*$/u)
    .max(64),
  language: z.string().trim().min(1).max(32),
  file_count: z.number().int().nonnegative(),
});

export type WorkspacePromptMetadata = z.infer<
  typeof WorkspacePromptMetadataSchema
>;

export interface PromptComponentContent {
  readonly id: string;
  readonly version: string;
  readonly content: string;
}

export interface PromptComposition {
  readonly system_context: string;
  readonly manifest: PromptManifest;
  readonly components: readonly PromptComponentContent[];
}

export interface JudgePromptInput {
  readonly prompt_variant: string;
  readonly output_contract_version: string;
  readonly workspace: WorkspacePromptMetadata;
  readonly enabled_skill_ids: readonly string[];
  readonly limits: RunLimits;
  readonly recovery_limits: {
    readonly max_repair_attempts: number;
  };
  readonly policy: {
    readonly workspace: {
      readonly read_only: boolean;
      readonly relative_paths_only: boolean;
      readonly deny_path_traversal: boolean;
      readonly deny_symlink_escape: boolean;
    };
    readonly tools: {
      readonly allowed_capabilities: readonly ToolCapability[];
      readonly network_allowed: boolean;
    };
  };
}

export function normalizePromptContent(content: string): string {
  return content
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .normalize("NFC");
}

export function sha256(value: string): `sha256:${string}` {
  const digest = createHash("sha256")
    .update(Buffer.from(value, "utf8"))
    .digest("hex");
  return `sha256:${digest}`;
}

export function createPromptManifest(
  componentValues: readonly PromptComponentContent[],
): PromptManifest {
  const components = componentValues.map((value) => {
    const parsed = PromptComponentInputSchema.parse(value);
    return {
      id: parsed.id,
      version: parsed.version,
      content_hash: sha256(normalizePromptContent(parsed.content)),
    };
  });
  const aggregateInput = JSON.stringify(
    components.map(({ id, version, content_hash }) => ({
      id,
      version,
      content_hash,
    })),
  );
  return PromptManifestSchema.parse({
    schema_version: 1,
    components,
    aggregate_hash: sha256(aggregateInput),
  });
}

function harnessPolicyContent(policy: JudgePromptInput["policy"]): string {
  const capabilities = policy.tools.allowed_capabilities.join(", ");
  return [
    "Operate only inside the supplied source workspace.",
    `Workspace access is ${policy.workspace.read_only ? "read-only" : "writable"}.`,
    "Use relative paths only; path traversal and symlink escape are forbidden.",
    `Allowed tool capabilities: ${capabilities || "none"}.`,
    `Network access is ${policy.tools.network_allowed ? "allowed" : "denied"}.`,
    "Never request, infer, or reveal ground truth, expected verdicts, host paths, credentials, or policy bypass instructions.",
  ].join("\n");
}

function judgeInstructionContent(): string {
  return [
    "Evaluate the supplied smart-contract finding against only the supplied source evidence.",
    "Return valid when the claim is supported, invalid when contradicted, and uncertain when available evidence is insufficient.",
    "Do not invent source behavior or treat a missing tool result as evidence.",
  ].join("\n");
}

function workspaceMetadataContent(workspace: WorkspacePromptMetadata): string {
  return JSON.stringify({
    source_label: workspace.source_label,
    language: workspace.language,
    file_count: workspace.file_count,
  });
}

function skillSummaryContent(skillIds: readonly string[]): string {
  if (skillIds.length === 0) {
    return "No skills are enabled for this run.";
  }
  return `Enabled skill IDs: ${skillIds.join(", ")}.`;
}

function budgetContent(input: JudgePromptInput): string {
  return [
    `Maximum agent steps: ${input.limits.max_steps}.`,
    `Wall-clock timeout: ${input.limits.wall_clock_timeout_ms} ms.`,
    `Maximum input tokens: ${input.limits.max_input_tokens}.`,
    `Maximum output tokens: ${input.limits.max_output_tokens}.`,
    `Maximum repair attempts: ${input.recovery_limits.max_repair_attempts}.`,
    "Stop when a structured verdict is supported or when a configured limit is reached.",
  ].join("\n");
}

function outputContractContent(version: string): string {
  return [
    `JudgeVerdict contract version: ${version}.`,
    "Return exactly one structured object with classification, severity, reasoning_summary, and evidence_refs.",
    "classification must be valid, invalid, or uncertain. Do not return a prose-only verdict.",
  ].join("\n");
}

export function composeJudgePrompt(value: JudgePromptInput): PromptComposition {
  const workspace = WorkspacePromptMetadataSchema.safeParse(value.workspace);
  if (!workspace.success) {
    throw new ConfigurationError(
      ConfigurationErrorCode.invalidPromptInput,
      "Workspace prompt metadata is invalid.",
      { issue_count: workspace.error.issues.length },
    );
  }
  if (value.prompt_variant !== "judge-v0") {
    throw new ConfigurationError(
      ConfigurationErrorCode.invalidPromptInput,
      "Slice 1 supports only the judge-v0 prompt variant.",
    );
  }

  const components = [
    {
      id: "harness-policy",
      version: "1.0.0",
      content: harnessPolicyContent(value.policy),
    },
    {
      id: "judge-instruction",
      version: "1.0.0",
      content: judgeInstructionContent(),
    },
    {
      id: "workspace-metadata",
      version: "1.0.0",
      content: workspaceMetadataContent(workspace.data),
    },
    {
      id: "enabled-skill-summary",
      version: "1.0.0",
      content: skillSummaryContent(value.enabled_skill_ids),
    },
    {
      id: "run-budget",
      version: "1.0.0",
      content: budgetContent(value),
    },
    {
      id: "judge-output-contract",
      version: value.output_contract_version,
      content: outputContractContent(value.output_contract_version),
    },
  ] as const satisfies readonly PromptComponentContent[];

  const normalizedComponents = components.map((component) => ({
    ...component,
    content: normalizePromptContent(component.content),
  }));
  const systemContext = normalizedComponents
    .map(({ id, version, content }) => `## ${id} (${version})\n${content}`)
    .join("\n\n");

  return {
    system_context: systemContext,
    manifest: createPromptManifest(normalizedComponents),
    components: Object.freeze(normalizedComponents),
  };
}
