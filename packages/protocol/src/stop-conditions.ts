import { z } from "zod"

/** Ordered by precedence: the first exhausted entry wins when several limits are reached at one safe boundary. */
export const StopReasons = [
  "wall_clock_timeout",
  "total_tokens_exhausted",
  "max_steps_exceeded",
  "max_tool_calls_exceeded",
  "context_budget_exhausted",
  "no_progress_detected",
] as const

export type StopReason = (typeof StopReasons)[number]

export const StopPrecedence: readonly StopReason[] = StopReasons

export const BudgetTerminalReasons = [
  "wall_clock",
  "cost_budget",
  "total_tokens",
  "max_steps",
  "max_tool_calls",
  "context_budget",
  "no_progress",
] as const

export type BudgetTerminalReason = (typeof BudgetTerminalReasons)[number]

export const StopReasonToTerminalReason = {
  wall_clock_timeout: "wall_clock",
  total_tokens_exhausted: "total_tokens",
  max_steps_exceeded: "max_steps",
  max_tool_calls_exceeded: "max_tool_calls",
  context_budget_exhausted: "context_budget",
  no_progress_detected: "no_progress",
} as const satisfies Record<StopReason, BudgetTerminalReason>

/** Terminal and error reasons by blueprint namespace (blueprint/vocabulary.md, vocabulary-v2). */
export const TerminalReasonNamespaces = {
  // Keep cost_budget in the terminal vocabulary so historical runs still parse.
  budget: BudgetTerminalReasons,
  provider: [
    "pre_network_profile_rejected",
    "pre_network_experiment_rejected",
    "provider_permanent",
    "provider_transient_primary",
    "provider_retries_exhausted",
    "attempt_outcome_unknown",
  ],
  contract: ["invalid_input", "schema_repair_exhausted", "evidence_invalid", "incompatible_version"],
  security: ["source_registration_denied", "snapshot_integrity", "workspace_preflight"],
  operator: ["cancelled_by_user", "work_handoff_failure", "persistence_failure", "worker_interrupted"],
} as const

export const TerminalReasons = [
  ...TerminalReasonNamespaces.budget,
  ...TerminalReasonNamespaces.provider,
  ...TerminalReasonNamespaces.contract,
  ...TerminalReasonNamespaces.security,
  ...TerminalReasonNamespaces.operator,
] as const

export type TerminalReason = (typeof TerminalReasons)[number]

export const TerminalReasonSchema = z.enum(TerminalReasons)

export const BudgetTerminalReasonSchema = z.enum(BudgetTerminalReasons)

export const BudgetLimitsSchema = z.object({
  wallClockTimeoutMs: z.number().int().positive(),
  /** Historical snapshots retain this value for digest compatibility; new run configs never set or enforce it. */
  costCeilingUsd: z.number().nonnegative().optional(),
  totalTokenBudget: z.number().int().positive(),
  maxSteps: z.number().int().positive(),
  maxToolCalls: z.number().int().positive().optional(),
  noProgressMaxRepeats: z.number().int().positive(),
})

export type BudgetLimits = z.infer<typeof BudgetLimitsSchema>
