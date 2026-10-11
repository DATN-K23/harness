import type { ContextEnginePort, ContextItem, ModelLimits, ModelUsage, RunBudget } from "@harness/protocol"
import type { IdGenerator } from "../util/id"
import { applyCompaction } from "./history-hydrator"
import { asFault, attemptPayload, bounded, sumUsage, type Persist } from "./judge-step-support"
import type { RetryPolicy, RetryRunInput } from "./retry-policy"
import type { TerminalCommit } from "./run-writer"

export interface CompactionInput {
  runId: string
  /** The step the compaction serves; its attempts are recorded under this index. */
  stepIndex: number
  profileId: string
  items: readonly ContextItem[]
  summaryPrompt: string
  itemsToSummarize: readonly ContextItem[]
  modelLimits: ModelLimits
  /** The run budget before the compaction attempt. */
  budget: RunBudget
  deadlineMs: number
  signal?: AbortSignal
  beforeRetry: RetryRunInput["beforeRetry"]
}

export interface CompactionDeps {
  retryPolicy: RetryPolicy
  contextEngine: ContextEnginePort
  persist: Persist
  ids: IdGenerator
}

export type Compaction =
  | { kind: "compacted"; items: ContextItem[]; usage: ModelUsage }
  /** The run ends; `usage` is still charged to the run. Budget terminals carry only their own reason as observed. */
  | { kind: "terminal"; terminal: TerminalCommit; usage: ModelUsage }

/**
 * One LLM compaction (design 3.5, D8): the summary request is an ordinary provider attempt through the retry policy
 * with full accounting and `record`, the summarized items are replaced by one `compaction_summary` item and
 * `context.compacted` is persisted. The caller has already checked the flag, `maxCompactions`, stop conditions and
 * cancellation, and calls `prepare` again afterwards.
 */
export const compactContext = async (deps: CompactionDeps, input: CompactionInput): Promise<Compaction> => {
  const instruction: ContextItem = {
    id: deps.ids.next("itm_"),
    turn: input.stepIndex - 1,
    type: "system_prompt",
    isPinned: false,
    content: input.summaryPrompt,
  }
  const retried = await deps.retryPolicy
    .run({
      request: {
        runId: input.runId,
        stepIndex: input.stepIndex,
        profileId: input.profileId,
        items: [...input.itemsToSummarize, instruction],
        toolsDisabled: true,
      },
      deadlineMs: input.deadlineMs,
      signal: input.signal,
      beforeRetry: input.beforeRetry,
    })
    .catch(asFault("worker_interrupted"))
  for (const attempt of retried.attempts)
    await deps.persist("provider.attempted", attemptPayload(input.stepIndex, input.profileId, attempt))
  const usage = sumUsage(retried.attempts)
  const stop = (terminal: TerminalCommit): Compaction => ({ kind: "terminal", terminal, usage })

  if (retried.kind === "failed")
    return stop({
      state: "failed",
      reason: retried.reason,
      message: `compaction attempt failed: ${bounded(retried.error.message, 500)}`,
    })
  if (retried.kind === "context_overflow")
    return stop({
      state: "budget_exhausted",
      reason: "context_budget_exhausted",
      observed: ["context_budget_exhausted"],
    })
  if (retried.kind === "stopped")
    return stop({ state: "budget_exhausted", reason: retried.reason, observed: [retried.reason] })
  if (retried.kind === "cancelled") return stop({ state: "cancelled", boundary: "before_provider_call" })

  const { response } = retried
  const failedSpend = sumUsage(retried.attempts.slice(0, -1))
  await deps.contextEngine
    .record({
      actualUsage: {
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
      },
      modelLimits: input.modelLimits,
      budget: {
        ...input.budget,
        totalTokensUsed: input.budget.totalTokensUsed + failedSpend.totalTokens,
        costUsd: input.budget.costUsd + failedSpend.costUsd,
      },
    })
    .catch(asFault("worker_interrupted"))

  const summary = response.content?.trim() ?? ""
  // Without a summary nothing can be replaced, so the context still does not fit.
  if (summary === "")
    return stop({
      state: "budget_exhausted",
      reason: "context_budget_exhausted",
      observed: ["context_budget_exhausted"],
    })
  const summaryItem: ContextItem = {
    id: deps.ids.next("itm_"),
    turn: input.stepIndex - 1,
    type: "compaction_summary",
    isPinned: false,
    content: summary,
  }
  const replacedItemIds = input.itemsToSummarize.map((item) => item.id)
  await deps.persist("context.compacted", { replacedItemIds, summaryItem, usage })
  return { kind: "compacted", items: applyCompaction(input.items, replacedItemIds, summaryItem), usage }
}
