import type {
  ContextEnginePort,
  ContextItem,
  PrepareResult,
  RecordResult,
  ShapeToolResultOutcome,
} from "@harness/protocol"
import { digestOf } from "../util/digest"

export const FakeContextEngineLabel =
  "FAKE context engine: the token estimate is ceil(characters / 4). It is a stand-in and NOT the authoritative o200k_base count."

type PrepareInput = Parameters<ContextEnginePort["prepare"]>[0]
type ShapeInput = Parameters<ContextEnginePort["shapeToolResult"]>[0]
type RecordInput = Parameters<ContextEnginePort["record"]>[0]

/** NOT the authoritative o200k_base count: a characters-over-four stand-in so tests need no tokenizer. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4)

export const estimateItemTokens = (items: readonly ContextItem[]) =>
  items.reduce((total, item) => total + estimateTokens(item.content), 0)

abstract class FakeContextEngine implements ContextEnginePort {
  readonly nonAuthoritative = true
  readonly label = FakeContextEngineLabel
  readonly prepareCalls: PrepareInput[] = []
  private lastEstimate = 0

  abstract prepare(input: PrepareInput): Promise<PrepareResult>

  async record(input: RecordInput): Promise<RecordResult> {
    return {
      totalTokensUsed: input.budget.totalTokensUsed + input.actualUsage.totalTokens,
      tokenDelta: input.actualUsage.promptTokens - this.lastEstimate,
      suggestedSafetyMargin: input.modelLimits.safetyMarginFactor,
    }
  }

  async shapeToolResult(input: ShapeInput): Promise<ShapeToolResultOutcome> {
    const tokensBefore = estimateTokens(input.content)
    const lines = input.content.split("\n")
    const limit = input.policy.toolOutputMaxLines
    if (!input.policy.flags.enableToolTruncation || lines.length <= limit)
      return { content: input.content, isTruncated: false, tokensBefore, tokensAfter: tokensBefore }
    const continuationNote = `[truncated ${input.toolName} output: showing ${limit} of ${lines.length} lines; narrow the request to see the rest]`
    const content = [...lines.slice(0, limit), continuationNote].join("\n")
    return { content, isTruncated: true, tokensBefore, tokensAfter: estimateTokens(content), continuationNote }
  }

  protected begin(input: PrepareInput) {
    this.prepareCalls.push(structuredClone(input))
    this.lastEstimate = estimateItemTokens(input.items)
    return this.lastEstimate
  }

  protected telemetry(input: PrepareInput, estimate: number): PrepareResult["telemetry"] {
    return {
      // The schema fixes this literal; the estimate behind it is the fake one described by `label`.
      tokenizer: "o200k_base",
      policyVersion: input.policy.policyVersion,
      estimatedInputTokens: estimate,
      estimatedSafetyTokens: Math.ceil(estimate * Math.max(0, input.modelLimits.safetyMarginFactor - 1)),
      windowLimitTokens: input.policy.windowLimitTokens,
      outputReserveTokens: input.policy.outputReserveTokens,
      tokensSaved: 0,
      budgetRemainingTokens: Math.max(0, input.budget.totalTokenLimit - input.budget.totalTokensUsed),
      contentDigest: digestOf(input.items),
    }
  }

  protected ready(input: PrepareInput, estimate: number): PrepareResult {
    return { status: "ready", preparedItems: input.items, telemetry: this.telemetry(input, estimate) }
  }
}

/** Always ready with the items unchanged; use it when a test is not about context management. */
export class PassThroughContextEngine extends FakeContextEngine {
  async prepare(input: PrepareInput) {
    return this.ready(input, this.begin(input))
  }
}

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
