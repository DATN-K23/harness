import type {
  ContextEnginePort,
  ContextItem,
  PrepareResult,
  RecordResult,
  ShapeToolResultOutcome,
} from "@harness/protocol"
import { digestOf } from "../util/digest"
import { estimateItemTokens, estimateTokens, FakeContextEngineLabel } from "./token-estimator"
import type { TokenizerPort } from "./o200k-tokenizer"
import { CompactionSummaryPrompt, MaskReport, maskOldToolResults, PromptCalibration, selectItemsToSummarize } from "./context-view"

export { maskOldToolResults } from "./context-view"

export type PrepareInput = Parameters<ContextEnginePort["prepare"]>[0]
export type ShapeInput = Parameters<ContextEnginePort["shapeToolResult"]>[0]
export type RecordInput = Parameters<ContextEnginePort["record"]>[0]
type ShapeInputWithRange = ShapeInput

const continuation = (input: ShapeInputWithRange, count: number, total: number) => {
  const nextLine = input.lineRange === undefined ? count + 1 : input.lineRange[0] + count
  const next = input.toolName === "read_file" && input.path !== undefined
    ? `read ${input.path} from line ${nextLine}`
    : "narrow the request to see the rest"
  return `[truncated ${input.toolName} output: showing ${count} of ${total} lines; ${next}]`
}

const continuationWithFallback = (input: ShapeInputWithRange, count: number, total: number) => {
  const exact = continuation(input, count, total)
  const nextLine = input.lineRange === undefined ? count + 1 : input.lineRange[0] + count
  return input.toolName === "read_file" && input.path !== undefined
    ? { exact, fallback: `[truncated ${input.toolName} output: showing ${count} of ${total} lines; read ${input.path}:${nextLine}-]` }
    : { exact, fallback: exact }
}

export abstract class FakeContextEngine implements ContextEnginePort {
  readonly nonAuthoritative = true
  readonly label = FakeContextEngineLabel
  readonly prepareCalls: PrepareInput[] = []
  private lastEstimate = 0
  private readonly calibration = new PromptCalibration(estimateTokens)
  private readonly maskReport = new MaskReport(estimateTokens)
  /** The items the current request sends (masked when masking is on). */
  private view: ContextItem[] = []

  abstract prepare(input: PrepareInput): Promise<PrepareResult>

  async record(input: RecordInput): Promise<RecordResult> {
    this.calibration.record(input.actualUsage, input.request)
    if (input.actualUsage === null) return { totalTokensUsed: input.budget.totalTokensUsed, tokenDelta: 0, suggestedSafetyMargin: input.modelLimits.safetyMarginFactor }
    return {
      totalTokensUsed: input.budget.totalTokensUsed + input.actualUsage.totalTokens,
      tokenDelta: input.actualUsage.promptTokens - this.lastEstimate,
      suggestedSafetyMargin: input.modelLimits.safetyMarginFactor,
    }
  }

  async shapeToolResult(input: ShapeInputWithRange): Promise<ShapeToolResultOutcome> {
    const tokensBefore = estimateTokens(input.content)
    const lines = input.content.split("\n")
    const limit = input.policy.toolOutputMaxLines
    if (!input.policy.flags.enableToolTruncation || lines.length <= limit)
      return { content: input.content, isTruncated: false, tokensBefore, tokensAfter: tokensBefore }
    const continuationNote = continuation(input, limit, lines.length)
    const content = [...lines.slice(0, limit), continuationNote].join("\n")
    return { content, isTruncated: true, tokensBefore, tokensAfter: estimateTokens(content), continuationNote, shownLines: limit }
  }

  protected begin(input: PrepareInput) {
    this.prepareCalls.push(structuredClone(input))
    this.calibration.begin()
    this.view = maskOldToolResults(input.items, input.policy)
    const characters = estimateItemTokens(this.view)
    this.lastEstimate = input.policy.tokenEstimate === "calibrated"
      ? (this.calibration.estimate(this.view, input.request) ?? characters)
      : characters
    return this.lastEstimate
  }

  /** The items a compaction should summarize under this request's estimate, or none when it cannot help. */
  protected itemsToSummarize(input: PrepareInput, estimate: number, threshold: number) {
    return selectItemsToSummarize({ history: input.items, view: this.view, policy: input.policy, estimate, threshold, count: estimateTokens })
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
      tokensSaved: Math.max(0, estimateItemTokens(input.items) - estimateItemTokens(this.view)),
      budgetRemainingTokens: Math.max(0, input.budget.totalTokenLimit - input.budget.totalTokensUsed),
      contentDigest: digestOf(input.items),
      requestDigest: input.request === undefined ? undefined : digestOf(input.request),
      estimatedOutputTokens: input.request?.maxOutputTokens ?? 0,
    }
  }

  protected ready(input: PrepareInput, estimate: number): PrepareResult {
    const items = this.view
    if (input.policy.tokenEstimate === "calibrated") this.calibration.sent(items, input.request)
    const transformations = this.maskReport.newlyMasked(input.items, items)
    const masked = items.some((item, index) => item !== input.items[index])
    return {
      status: "ready",
      preparedItems: masked ? items : input.items,
      ...(input.request !== undefined ? { preparedRequest: masked ? { ...input.request, items } : input.request } : {}),
      ...(transformations.length > 0 ? { transformations } : {}),
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

/**
 * Deterministic production operations. Input items must already have crossed the sanitizer boundary. With the policy
 * flags it masks old tool results, asks for an LLM compaction past the threshold, and with `tokenEstimate: calibrated`
 * starts its estimate from the provider's real prompt count, as the CLI engines do; counts use the o200k tokenizer.
 */
export class ProductionContextEngine implements ContextEnginePort {
  private readonly count: (text: string) => number
  private readonly calibration: PromptCalibration
  private readonly maskReport: MaskReport

  constructor(private readonly tokenizer: TokenizerPort) {
    this.count = (text) => tokenizer.count(text)
    this.calibration = new PromptCalibration(this.count)
    this.maskReport = new MaskReport(this.count)
  }

  async prepare(input: PrepareInput): Promise<PrepareResult> {
    const request = input.request
    if (request === undefined) throw new Error("ProductionContextEngine.prepare requires the canonical provider request")
    const nums = [input.policy.windowLimitTokens, input.policy.outputReserveTokens, input.policy.recentWindowTokens,
      input.policy.toolOutputMaxTokens, input.policy.toolOutputMaxLines, input.policy.maxCompactions,
      input.modelLimits.maxContextTokens, input.modelLimits.maxOutputTokens,
      input.policy.safetyMarginFactor, input.modelLimits.safetyMarginFactor,
      input.budget.totalTokensUsed, input.budget.totalTokenLimit, input.budget.compactionsCount,
       input.budget.costUsd, input.policy.compactionThreshold]
    if (nums.some((value) => !Number.isFinite(value)) ||
      input.policy.windowLimitTokens <= 0 || input.policy.outputReserveTokens <= 0 ||
      input.policy.recentWindowTokens < 0 || input.policy.toolOutputMaxTokens <= 0 ||
      input.policy.toolOutputMaxLines <= 0 || input.policy.maxCompactions < 0 ||
      input.modelLimits.maxContextTokens <= 0 || input.modelLimits.maxOutputTokens <= 0 || input.modelLimits.maxOutputTokens > input.modelLimits.maxContextTokens ||
      input.policy.outputReserveTokens > input.policy.windowLimitTokens ||
      input.policy.safetyMarginFactor < 1 || input.modelLimits.safetyMarginFactor < 1 ||
      input.policy.safetyMarginFactor !== input.modelLimits.safetyMarginFactor ||
      input.budget.totalTokensUsed < 0 || input.budget.totalTokenLimit <= 0 || input.budget.totalTokensUsed > input.budget.totalTokenLimit ||
       input.budget.compactionsCount < 0 || input.budget.costUsd < 0 ||
      input.policy.compactionThreshold <= 0 || input.policy.compactionThreshold > 1 ||
      (request.maxOutputTokens !== undefined && (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0))) {
      return { status: "stop", stopReason: "context_budget", preparedItems: input.items, telemetry: {
        tokenizer: this.tokenizer.id, policyVersion: input.policy.policyVersion, estimatedInputTokens: 0,
        estimatedSafetyTokens: 0, windowLimitTokens: 1, outputReserveTokens: 0, tokensSaved: 0,
        budgetRemainingTokens: 0, contentDigest: digestOf(input.items), requestDigest: digestOf(request), estimatedOutputTokens: 0,
      } }
    }
    this.calibration.begin()
    const view = maskOldToolResults(input.items, input.policy, this.count)
    const masked = view.some((item, index) => item !== input.items[index])
    const sent = masked ? { ...request, items: view } : request
    const counted = this.tokenizer.count(JSON.stringify(sent))
    const estimate = input.policy.tokenEstimate === "calibrated" ? (this.calibration.estimate(view, request) ?? counted) : counted
    const sizeOf = (items: readonly ContextItem[]) => items.reduce((total, item) => total + this.count(item.content), 0)
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
      tokensSaved: masked ? Math.max(0, sizeOf(input.items) - sizeOf(view)) : 0,
      budgetRemainingTokens: Math.max(0, input.budget.totalTokenLimit - input.budget.totalTokensUsed),
      contentDigest: digestOf(input.items),
      requestDigest,
      estimatedOutputTokens: requestedOutput,
    }
    const stop = { status: "stop" as const, stopReason: "context_budget" as const, preparedItems: input.items, telemetry }
    if (requestedOutputCap > input.policy.outputReserveTokens || input.modelLimits.maxOutputTokens < requestedOutputCap ||
      input.budget.totalTokensUsed + estimate + safety + requestedOutput > input.budget.totalTokenLimit)
      return stop
    // Past the threshold of the room left after the output, an LLM compaction runs while it is enabled, budgeted and
    // able to get under the threshold; otherwise the request goes as long as it still fits.
    const threshold = input.policy.compactionThreshold * (effectiveWindow - requestedOutput)
    if (estimate > threshold && input.policy.flags.enableLlmCompaction && input.budget.compactionsCount < input.policy.maxCompactions) {
      const itemsToSummarize = selectItemsToSummarize({ history: input.items, view, policy: input.policy, estimate, threshold, count: this.count })
      if (itemsToSummarize.length > 0)
        return { status: "needs_compaction", summaryPrompt: CompactionSummaryPrompt, itemsToSummarize, telemetry }
    }
    if (estimate + safety + requestedOutput > effectiveWindow) return stop
    if (input.policy.tokenEstimate === "calibrated") this.calibration.sent(view, request)
    const transformations = this.maskReport.newlyMasked(input.items, view)
    return {
      status: "ready",
      preparedItems: masked ? view : input.items,
      preparedRequest: sent,
      ...(transformations.length > 0 ? { transformations } : {}),
      telemetry,
    }
  }

  async record(input: RecordInput): Promise<RecordResult> {
    this.calibration.record(input.actualUsage, input.request)
    if (input.actualUsage === null) return { totalTokensUsed: input.budget.totalTokensUsed, tokenDelta: 0, suggestedSafetyMargin: input.modelLimits.safetyMarginFactor }
    return {
      totalTokensUsed: input.budget.totalTokensUsed + input.actualUsage.totalTokens,
      tokenDelta: input.actualUsage.promptTokens,
      suggestedSafetyMargin: input.modelLimits.safetyMarginFactor,
    }
  }

  async shapeToolResult(input: ShapeInputWithRange): Promise<ShapeToolResultOutcome> {
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
    const totalLines = input.content.split("\n").length
    let { exact: fullContinuationNote, fallback } = continuationWithFallback(input, count, totalLines)
    let continuationNote = fullContinuationNote
    let content = ""
    while (true) {
      const candidate = prefix ? `${prefix}\n${continuationNote}` : continuationNote
      if (this.tokenizer.count(candidate) <= input.policy.toolOutputMaxTokens) {
        content = candidate
        break
      }
      if (continuationNote !== fallback) {
        continuationNote = fallback
        continue
      }
      const retained = prefix.split("\n").slice(0, -1).join("\n")
      if (retained) {
        prefix = retained
        count = retained.split("\n").length
        ;({ exact: continuationNote, fallback } = continuationWithFallback(input, count, totalLines))
        fullContinuationNote = continuationNote
        continue
      }
      break
    }
    return {
      content,
      isTruncated: true,
      tokensBefore,
      tokensAfter: this.tokenizer.count(content),
      continuationNote: fullContinuationNote,
      shownLines: prefix === "" ? 0 : count,
    }
  }
}
