import { z } from "zod"

export const ContextItemTypes = [
  "system_prompt",
  "tool_description",
  "candidate_finding",
  "submitter_poc",
  "bce_sliced_ast",
  "assistant_reasoning",
  "tool_request",
  "tool_result",
  "execution_trace",
  "compaction_summary",
  "session_note",
] as const

export type ContextItemType = (typeof ContextItemTypes)[number]

export const ContextItemSchema = z.object({
  id: z.string(),
  turn: z.number().int().nonnegative(),
  type: z.enum(ContextItemTypes),
  isPinned: z.boolean(),
  content: z.string(),
  toolMeta: z
    .object({
      callId: z.string(),
      toolName: z.string(),
      filePath: z.string().optional(),
      lineRange: z.tuple([z.number().int(), z.number().int()]).optional(),
      isError: z.boolean().optional(),
    })
    .optional(),
})

export type ContextItem = z.infer<typeof ContextItemSchema>

export const selectPinnedItems = (items: readonly ContextItem[]) => items.filter((item) => item.isPinned)

export interface ContextPolicy {
  policyVersion: string
  windowLimitTokens: number
  outputReserveTokens: number
  compactionThreshold: number
  recentWindowTokens: number
  toolOutputMaxTokens: number
  toolOutputMaxLines: number
  maxCompactions: number
  flags: {
    enableToolTruncation: boolean
    enableObsMasking: boolean
    enableSupersedeReads: boolean
    enableDropEmpty: boolean
    enableLlmCompaction: boolean
    enableSessionNote: boolean
  }
}

export interface ModelLimits {
  maxContextTokens: number
  maxOutputTokens: number
  safetyMarginFactor: number
}

export interface RunBudget {
  totalTokensUsed: number
  totalTokenLimit: number
  compactionsCount: number
  costUsd: number
  costCeilingUsd: number
}

const TransformationSchema = z.object({
  action: z.enum(["masked", "dropped_empty", "superseded", "truncated"]),
  targetItemId: z.string(),
  tokensBefore: z.number(),
  tokensAfter: z.number(),
  replacementNote: z.string(),
})

const PrepareTelemetrySchema = z.object({
  tokenizer: z.literal("o200k_base"),
  policyVersion: z.string(),
  estimatedInputTokens: z.number(),
  estimatedSafetyTokens: z.number(),
  windowLimitTokens: z.number(),
  outputReserveTokens: z.number(),
  tokensSaved: z.number(),
  budgetRemainingTokens: z.number(),
  contentDigest: z.string(),
})

const prepareBase = {
  transformations: z.array(TransformationSchema).optional(),
  telemetry: PrepareTelemetrySchema,
}

export const PrepareResultSchema = z.discriminatedUnion("status", [
  z.object({
    ...prepareBase,
    status: z.literal("ready"),
    preparedItems: z.array(ContextItemSchema),
  }),
  z.object({
    ...prepareBase,
    status: z.literal("needs_compaction"),
    summaryPrompt: z.string(),
    itemsToSummarize: z.array(ContextItemSchema),
  }),
  z.object({
    ...prepareBase,
    status: z.literal("stop"),
    stopReason: z.enum(["context_budget", "total_tokens"]),
    preparedItems: z.array(ContextItemSchema).optional(),
  }),
])

export type PrepareResult = z.infer<typeof PrepareResultSchema>

export interface RecordResult {
  totalTokensUsed: number
  tokenDelta: number
  suggestedSafetyMargin: number
}

export interface ShapeToolResultOutcome {
  content: string
  isTruncated: boolean
  tokensBefore: number
  tokensAfter: number
  continuationNote?: string
}

export interface ContextEnginePort {
  prepare(input: {
    items: ContextItem[]
    policy: ContextPolicy
    modelLimits: ModelLimits
    budget: RunBudget
  }): Promise<PrepareResult>

  record(input: {
    actualUsage: { promptTokens: number; completionTokens: number; totalTokens: number }
    modelLimits: ModelLimits
    budget: RunBudget
  }): Promise<RecordResult>

  shapeToolResult(input: { content: string; toolName: string; policy: ContextPolicy }): Promise<ShapeToolResultOutcome>
}
