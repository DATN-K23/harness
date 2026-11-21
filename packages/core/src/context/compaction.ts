// Adapted from OpenCode packages/core/src/session/compaction.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { PrepareResult } from "@harness/protocol"
import { FakeContextEngine, type PrepareInput } from "./context-engine"
import { CompactionSummaryPrompt } from "./context-view"

/**
 * Decides from the estimate alone. `compactionThreshold` is read as a fraction of the room left after the output
 * reserve. Over the threshold it asks for compaction while compaction is enabled and budgeted, over the room itself it
 * stops with `context_budget`, and a run that would pass its total token limit stops with `total_tokens`. It never
 * asks for a compaction that cannot get under the threshold, since even an empty summary would leave the pinned and
 * recent items over it (a window too small for `recentWindowTokens`).
 */
export class ThresholdContextEngine extends FakeContextEngine {
  async prepare(input: PrepareInput): Promise<PrepareResult> {
    const estimate = this.begin(input)
    const telemetry = this.telemetry(input, estimate)
    const { policy, budget } = input
    if (budget.totalTokensUsed + estimate > budget.totalTokenLimit)
      return { status: "stop", stopReason: "total_tokens", telemetry }

    const room = policy.windowLimitTokens - policy.outputReserveTokens
    const threshold = policy.compactionThreshold * room
    if (estimate <= threshold) return this.ready(input, estimate)

    const canCompact = policy.flags.enableLlmCompaction && budget.compactionsCount < policy.maxCompactions
    const itemsToSummarize = canCompact ? this.itemsToSummarize(input, estimate, threshold) : []
    if (itemsToSummarize.length > 0)
      return {
        status: "needs_compaction",
        summaryPrompt: CompactionSummaryPrompt,
        itemsToSummarize,
        telemetry,
      }
    if (estimate > room) return { status: "stop", stopReason: "context_budget", telemetry }
    return this.ready(input, estimate)
  }
}

type WithOptionalTelemetry<Result> = Result extends PrepareResult
  ? Omit<Result, "telemetry"> & { telemetry?: Result["telemetry"] }
  : never

export type ScriptedPrepareResult = WithOptionalTelemetry<PrepareResult>

export type ScriptedPrepareEntry = ScriptedPrepareResult | ((input: PrepareInput) => ScriptedPrepareResult)

/** Plays one scripted `PrepareResult` per call to force compaction, stops or transformations; passes through after. */
export class ScriptedContextEngine extends FakeContextEngine {
  private readonly script: ScriptedPrepareEntry[]
  private cursor = 0

  constructor(script: readonly ScriptedPrepareEntry[]) {
    super()
    this.script = [...script]
  }

  push(...entries: ScriptedPrepareEntry[]) {
    this.script.push(...entries)
  }

  async prepare(input: PrepareInput): Promise<PrepareResult> {
    const estimate = this.begin(input)
    const entry = this.script[this.cursor]
    if (entry === undefined) return this.ready(input, estimate)
    this.cursor += 1
    const scripted = typeof entry === "function" ? entry(input) : entry
    return {
      ...scripted,
      ...(scripted.status === "ready" && scripted.preparedRequest === undefined && input.request !== undefined
        ? { preparedRequest: input.request }
        : {}),
      telemetry: scripted.telemetry ?? this.telemetry(input, estimate),
    }
  }
}
