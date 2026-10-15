// Adapted from OpenCode packages/core/src/session/compaction.ts @ 3f393d78bf (MIT License). See NOTICE.
import type { PrepareResult } from "@harness/protocol"
import { FakeContextEngine, type PrepareInput } from "./context-engine"
import { estimateTokens } from "./token-estimator"

/**
 * Decides from the estimate alone. `compactionThreshold` is read as a fraction of the room left after the output
 * reserve. Over the threshold it asks for compaction while compaction is enabled and budgeted, over the room itself it
 * stops with `context_budget`, and a run that would pass its total token limit stops with `total_tokens`.
 */
export class ThresholdContextEngine extends FakeContextEngine {
  async prepare(input: PrepareInput): Promise<PrepareResult> {
    const estimate = this.begin(input)
    const telemetry = this.telemetry(input, estimate)
    const { policy, budget } = input
    if (budget.totalTokensUsed + estimate > budget.totalTokenLimit)
      return { status: "stop", stopReason: "total_tokens", telemetry }

    const room = policy.windowLimitTokens - policy.outputReserveTokens
    if (estimate <= policy.compactionThreshold * room) return this.ready(input, estimate)

    const canCompact = policy.flags.enableLlmCompaction && budget.compactionsCount < policy.maxCompactions
    const itemsToSummarize = canCompact ? this.olderUnpinned(input) : []
    if (itemsToSummarize.length > 0)
      return {
        status: "needs_compaction",
        summaryPrompt: "Summarize these context items, keeping every finding and file reference.",
        itemsToSummarize,
        telemetry,
      }
    if (estimate > room) return { status: "stop", stopReason: "context_budget", telemetry }
    return this.ready(input, estimate)
  }

  private olderUnpinned(input: PrepareInput) {
    const recent = new Set<string>()
    let recentTokens = 0
    for (const item of input.items.toReversed()) {
      if (recentTokens >= input.policy.recentWindowTokens) break
      recent.add(item.id)
      recentTokens += estimateTokens(item.content)
    }
    return input.items.filter((item) => !item.isPinned && !recent.has(item.id))
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
    return { ...scripted, telemetry: scripted.telemetry ?? this.telemetry(input, estimate) }
  }
}
