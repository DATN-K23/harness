import { z } from "zod"
import type { ContextPolicy } from "./context"
import { BudgetLimitsSchema } from "./stop-conditions"

export const Sha256DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)

/**
 * Sorted-key JSON used as the byte string behind every digest. Hashing happens in `@harness/core`,
 * so this module stays free of crypto. Values without a stable JSON form throw instead of being coerced.
 */
export const canonicalize = (value: unknown): string => {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`cannot canonicalize non-finite number ${value}`)
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item === undefined ? null : item)).join(",")}]`
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, inner]) => inner !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, inner]) => `${JSON.stringify(key)}:${canonicalize(inner)}`)
      .join(",")}}`
  }
  throw new TypeError(`cannot canonicalize value of type ${typeof value}`)
}

export const ContextFlagNames = [
  "enableToolTruncation",
  "enableObsMasking",
  "enableSupersedeReads",
  "enableDropEmpty",
  "enableLlmCompaction",
  "enableSessionNote",
] as const

export const LoopFlagNames = [
  "enableSchemaRepair",
  "enableMaxStepsForcing",
  "enableNoProgressDetection",
  "enableInfraRetry",
  "enableParallelToolDispatch",
] as const

export const ResolvedFlagNames = [...ContextFlagNames, ...LoopFlagNames] as const

export type ResolvedFlagName = (typeof ResolvedFlagNames)[number]

export const ResolvedFlagsSchema = z.object(
  Object.fromEntries(ResolvedFlagNames.map((name) => [name, z.boolean()])) as Record<ResolvedFlagName, z.ZodBoolean>,
)

export type ResolvedFlags = z.infer<typeof ResolvedFlagsSchema>

export const RetryConfigSchema = z.object({
  maxRetries: z.number().int().nonnegative(),
  maxTimeoutRetries: z.number().int().nonnegative(),
  baseDelayMs: z.number().int().nonnegative(),
  maxDelayMs: z.number().int().nonnegative(),
  jitterMs: z.number().int().nonnegative(),
  retryableStatuses: z.array(z.number().int()),
})

export type RetryConfig = z.infer<typeof RetryConfigSchema>

export const DefaultRetryConfig: RetryConfig = {
  maxRetries: 5,
  maxTimeoutRetries: 3,
  baseDelayMs: 2000,
  maxDelayMs: 10000,
  jitterMs: 1000,
  retryableStatuses: [429, 500, 503],
}

export const DefaultMaxProbeRuns = 2

export const ContextPolicySchema = z.object({
  policyVersion: z.string(),
  windowLimitTokens: z.number().int().positive(),
  outputReserveTokens: z.number().int().nonnegative(),
  compactionThreshold: z.number(),
  /** Defaults only when reading legacy snapshots; current run inputs still supply the selected value explicitly. */
  safetyMarginFactor: z.number().gt(0).default(1.2),
  recentWindowTokens: z.number().int().nonnegative(),
  toolOutputMaxTokens: z.number().int().nonnegative(),
  toolOutputMaxLines: z.number().int().nonnegative(),
  maxCompactions: z.number().int().nonnegative(),
  flags: z.object({
    enableToolTruncation: z.boolean(),
    enableObsMasking: z.boolean(),
    enableSupersedeReads: z.boolean(),
    enableDropEmpty: z.boolean(),
    enableLlmCompaction: z.boolean(),
    enableSessionNote: z.boolean(),
  }),
}) satisfies z.ZodType<ContextPolicy>

export const ToolLimitsSchema = z.object({
  readFile: z.object({ maxLines: z.number().int().positive(), maxBytes: z.number().int().positive() }),
  grep: z.object({
    timeoutMs: z.number().int().positive(),
    maxScanBytes: z.number().int().positive(),
    maxLineChars: z.number().int().positive(),
    maxMatches: z.number().int().positive(),
  }),
  glob: z.object({ maxMatches: z.number().int().positive() }),
  listDir: z.object({ maxEntries: z.number().int().positive() }),
})

export type ToolLimits = z.infer<typeof ToolLimitsSchema>
export const RunConfigSnapshotSchema = z
  .object({
    flags: ResolvedFlagsSchema,
    contextPolicy: ContextPolicySchema,
    retry: RetryConfigSchema,
    budget: BudgetLimitsSchema,
    toolLimits: ToolLimitsSchema.optional(),
    maxProbeRuns: z.number().int().nonnegative(),
    enablePocExecution: z.boolean().default(false),
    runtime: z.object({
      providerName: z.string().min(1), modelName: z.string().min(1), baseURL: z.string().optional(),
      timeoutMs: z.number().int().positive(), inputCostPerMTok: z.number().nonnegative().optional(),
      outputCostPerMTok: z.number().nonnegative().optional(), profileVersion: z.string().min(1),
      ingestionVersion: z.string().min(1), sandboxMode: z.enum(["disabled", "enabled"]),
      maxContextTokens: z.number().int().positive(), maxOutputTokens: z.number().int().positive(),
      solidityCompilerVersion: z.string().min(1), foundryImage: z.string().min(1),
    }).optional(),
    systemPromptDigest: Sha256DigestSchema,
    verdictSchemaDigest: Sha256DigestSchema,
  })
  .superRefine((snapshot, ctx) => {
    ContextFlagNames.filter((name) => snapshot.flags[name] !== snapshot.contextPolicy.flags[name]).forEach((name) =>
      ctx.addIssue({
        code: "custom",
        path: ["flags", name],
        message: `${name} disagrees with contextPolicy.flags.${name}`,
      }),
    )
  })

/** The resolved configuration recorded in `run.started`; its digest is SHA-256 over `canonicalize(snapshot)`. */
export type RunConfigSnapshot = z.infer<typeof RunConfigSnapshotSchema>
