// Harness-owned implementation. OpenCode reference checkout inspected at 5542415b6424aa9bad8827dc72e8cd0630b2c0ab;
// no source algorithm was copied, and requested revision 3f393d78bf was unavailable.
import type {
  ContextEnginePort,
  PrepareResult,
  RecordResult,
  ShapeToolResultOutcome,
} from "@harness/protocol"
import { digestOf } from "../util/digest"
import { estimateItemTokens, estimateTokens, FakeContextEngineLabel } from "./token-estimator"
import type { TokenizerPort } from "./o200k-tokenizer"

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
    if (input.actualUsage === null) return { totalTokensUsed: input.budget.totalTokensUsed, tokenDelta: 0, suggestedSafetyMargin: input.modelLimits.safetyMarginFactor }
    return {
      totalTokensUsed: input.budget.totalTokensUsed + input.actualUsage.totalTokens,
      tokenDelta: input.actualUsage.promptTokens - this.lastEstimate,
      suggestedSafetyMargin: input.modelLimits.safetyMarginFactor,
    }
  }

  async shapeToolResult(input: ShapeInput): Promise<ShapeToolResultOutcome> {
    const tokensBefore = estimateTokens(input.content)
    const lines = input.content.split("\n").slice(0, input.policy.toolOutputMaxLines)
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
      requestDigest: input.request === undefined ? undefined : digestOf(input.request),
      estimatedOutputTokens: input.request?.maxOutputTokens ?? 0,
    }
  }

  protected ready(input: PrepareInput, estimate: number): PrepareResult {
    return {
      status: "ready",
      preparedItems: input.items,
      ...(input.request !== undefined ? { preparedRequest: input.request } : {}),
      telemetry: this.telemetry(input, estimate),
    }
  }
}

/** Always ready with the items unchanged; use it when a test is not about context management. */
export class PassThroughContextEngine extends FakeContextEngine {
  async prepare(input: PrepareInput) {
    return this.ready(input, this.begin(input))
  }
}

/** Deterministic production operations. Input items must already have crossed the sanitizer boundary. */
export class ProductionContextEngine implements ContextEnginePort {
  constructor(private readonly tokenizer: TokenizerPort) {}

  async prepare(input: PrepareInput): Promise<PrepareResult> {
    const request = input.request
    if (request === undefined) throw new Error("ProductionContextEngine.prepare requires the canonical provider request")
    const estimate = this.tokenizer.count(JSON.stringify(request))
    const safety = Math.ceil(estimate * (input.modelLimits.safetyMarginFactor - 1))
    const effectiveWindow = Math.min(input.policy.windowLimitTokens, input.modelLimits.maxContextTokens)
    const requestedOutput = request.maxOutputTokens === undefined
      ? input.policy.outputReserveTokens
      : Math.min(input.policy.outputReserveTokens, request.maxOutputTokens)
    const requestedOutputCap = request.maxOutputTokens ?? requestedOutput
    const requestDigest = digestOf(request)
    const telemetry = {
      tokenizer: this.tokenizer.id,
      policyVersion: input.policy.policyVersion,
      estimatedInputTokens: estimate,
      estimatedSafetyTokens: safety,
      windowLimitTokens: effectiveWindow,
      outputReserveTokens: requestedOutput,
      tokensSaved: 0,
      budgetRemainingTokens: Math.max(0, input.budget.totalTokenLimit - input.budget.totalTokensUsed),
      contentDigest: digestOf(input.items),
      requestDigest,
      estimatedOutputTokens: requestedOutput,
    }
    if (input.modelLimits.maxOutputTokens < requestedOutputCap ||
      input.budget.totalTokensUsed + estimate + safety + requestedOutput > input.budget.totalTokenLimit ||
      estimate + safety + requestedOutput > effectiveWindow) {
      return { status: "stop", stopReason: "context_budget", preparedItems: input.items, telemetry }
    }
    return { status: "ready", preparedItems: input.items, preparedRequest: request, telemetry }
  }

  async record(input: RecordInput): Promise<RecordResult> {
    if (input.actualUsage === null) return { totalTokensUsed: input.budget.totalTokensUsed, tokenDelta: 0, suggestedSafetyMargin: input.modelLimits.safetyMarginFactor }
    return {
      totalTokensUsed: input.budget.totalTokensUsed + input.actualUsage.totalTokens,
      tokenDelta: input.actualUsage.promptTokens,
      suggestedSafetyMargin: input.modelLimits.safetyMarginFactor,
    }
  }

  async shapeToolResult(input: ShapeInput): Promise<ShapeToolResultOutcome> {
    const tokensBefore = this.tokenizer.count(input.content)
    if (!input.policy.flags.enableToolTruncation || (tokensBefore <= input.policy.toolOutputMaxTokens && input.content.split("\n").length <= input.policy.toolOutputMaxLines)) {
      return { content: input.content, isTruncated: false, tokensBefore, tokensAfter: tokensBefore }
    }
    const allLines = input.content.split("\n")
    const lines = allLines.slice(0, input.policy.toolOutputMaxLines)
    let prefix = ""
    let count = 0
    for (const line of lines) {
      const candidate = prefix ? `${prefix}\n${line}` : line
      if (this.tokenizer.count(candidate) > input.policy.toolOutputMaxTokens) break
      prefix = candidate
      count++
    }
    let continuationNote = `[truncated ${input.toolName} output: showing ${count} of ${input.content.split("\n").length} lines; continue with a narrower read]`
    let content = ""
    while (true) {
      const candidate = prefix ? `${prefix}\n${continuationNote}` : continuationNote
      if (this.tokenizer.count(candidate) <= input.policy.toolOutputMaxTokens) {
        content = candidate
        break
      }
      const retained = prefix.split("\n").slice(0, -1).join("\n")
      if (retained) {
        prefix = retained
        count = retained.split("\n").length
        continuationNote = `[truncated ${input.toolName} output: showing ${count} of ${input.content.split("\n").length} lines; continue with a narrower read]`
        continue
      }
      break
    }
    return { content, isTruncated: true, tokensBefore, tokensAfter: this.tokenizer.count(content), continuationNote }
  }
}
