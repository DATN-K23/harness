// Adapted from OpenCode packages/core/src/session/context-engine.ts @ 3f393d78bf (MIT License). See NOTICE.
import type {
  ContextEnginePort,
  PrepareResult,
  RecordResult,
  ShapeToolResultOutcome,
} from "@harness/protocol"
import { digestOf } from "../util/digest"
import { estimateItemTokens, estimateTokens, FakeContextEngineLabel } from "./token-estimator"

export type PrepareInput = Parameters<ContextEnginePort["prepare"]>[0]
export type ShapeInput = Parameters<ContextEnginePort["shapeToolResult"]>[0]
export type RecordInput = Parameters<ContextEnginePort["record"]>[0]

export abstract class FakeContextEngine implements ContextEnginePort {
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
