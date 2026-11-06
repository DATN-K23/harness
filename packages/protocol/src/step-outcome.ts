import type { ContextItem } from "./context"
import type { ToolExecutionResult } from "./ports"
import type { StopReason, TerminalReason } from "./stop-conditions"
import type { JudgeVerdict } from "./verdict"

export interface ToolCallOutcome {
  callIndex: number
  callId: string
  toolName: string
  arguments: Record<string, unknown>
  result: ToolExecutionResult
}

export type StepOutcome =
  | { type: "completed"; verdict: JudgeVerdict }
  | { type: "needs_compaction"; summaryPrompt: string; itemsToSummarize: ContextItem[] }
  | { type: "continue_turn"; toolOutcomes: ToolCallOutcome[] }
  | { type: "budget_exhausted"; reason: StopReason }
  | { type: "failed"; error: string; reason?: TerminalReason }
