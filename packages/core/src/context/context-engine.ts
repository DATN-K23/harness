import type {
  ContextEnginePort,
  ContextItem,
  ContextPolicy,
  ModelAttemptRequest,
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

/** What a ready request held, so the provider's real prompt count for it can anchor the next estimate. */
interface SentShape {
  itemIds: string[]
  /** Estimated tokens of each item as sent, so a later change to it (masking) can be added to the real count. */
  itemTokens: number[]
  toolTokens: number
}

type Transformation = NonNullable<PrepareResult["transformations"]>[number]

const maskNote = (item: ContextItem) => {
  const meta = item.toolMeta
  const range = meta?.lineRange === undefined ? "" : ` lines ${meta.lineRange[0]}-${meta.lineRange[1]}`
  const where = meta?.filePath === undefined ? "" : ` for ${meta.filePath}${range}`
  const lines = item.content.split("\n").length
  return `[earlier ${meta?.toolName ?? "tool"} result${where} hidden to save context (${lines} lines); call the tool again if you need it]`
}

/**
 * With `enableObsMasking`, every unpinned tool result behind the newest `recentWindowTokens` of context is replaced by
 * a one-line note naming what it held. The history itself is unchanged: each request derives its view from it again.
 */
export const maskOldToolResults = (items: readonly ContextItem[], policy: ContextPolicy): ContextItem[] => {
  if (!policy.flags.enableObsMasking) return [...items]
  let newer = 0
  return items
    .toReversed()
    .map((item) => {
      const old = newer >= policy.recentWindowTokens
      newer += estimateTokens(item.content)
      if (!old || item.isPinned || item.type !== "tool_result") return item
      const content = maskNote(item)
      return content.length < item.content.length ? { ...item, content } : item
    })
    .toReversed()
}

/** Tokens of the tool definitions a request sends; a request with tools disabled sends none. */
const toolTokens = (request: ModelAttemptRequest | undefined) =>
  request?.tools === undefined || request.toolsDisabled === true ? 0 : estimateTokens(JSON.stringify(request.tools))

export abstract class FakeContextEngine implements ContextEnginePort {
  readonly nonAuthoritative = true
  readonly label = FakeContextEngineLabel
  readonly prepareCalls: PrepareInput[] = []
  private lastEstimate = 0
  /** The last ready request of a `calibrated` policy, waiting for its real usage in `record`. */
  private pending: SentShape | undefined
  /** The latest request whose real prompt count the provider reported. */
  private anchor: (SentShape & { promptTokens: number }) | undefined
  /** The items the current request sends (masked when masking is on). */
  protected view: ContextItem[] = []
  /** Items whose masking was already reported, so each masking is persisted once, not on every later step. */
  private readonly maskedIds = new Set<string>()

  abstract prepare(input: PrepareInput): Promise<PrepareResult>

  async record(input: RecordInput): Promise<RecordResult> {
    // Usage of a compaction call has no pending shape (its prepare was not ready), so it never becomes the anchor.
    if (this.pending !== undefined && input.actualUsage !== null && input.actualUsage.promptTokens > 0) {
      const sent = input.request
      const prepared = new Set(this.pending.itemIds)
      // Items the runner added after `prepare` (a forced step's instruction) are in the real count but not in the
      // history the next request extends, so they leave the anchor; its tools are the ones really sent.
      const added = sent === undefined ? 0 : estimateItemTokens(sent.items.filter((item) => !prepared.has(item.id)))
      this.anchor = {
        ...this.pending,
        toolTokens: sent === undefined ? this.pending.toolTokens : toolTokens(sent),
        promptTokens: Math.max(0, input.actualUsage.promptTokens - added),
      }
    }
    this.pending = undefined
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
    this.pending = undefined
    this.view = maskOldToolResults(input.items, input.policy)
    const characters = estimateItemTokens(this.view)
    this.lastEstimate = input.policy.tokenEstimate === "calibrated" ? (this.calibrated(input) ?? characters) : characters
    return this.lastEstimate
  }

  /**
   * The provider's real prompt count of the last request plus a characters-over-four estimate of what changed since:
   * the items appended after it, earlier items now sent shorter (masked), and the difference in tool definitions.
   * Undefined without a real count, or when the items no longer extend that request (a compaction replaced some), so
   * the caller falls back to characters. Without the sent request in `record`, what the runner adds after `prepare`
   * stays in the anchor and the next estimate runs a few hundred tokens high.
   * The real count also holds any prompt a router adds; only the first request, estimated from characters, misses it.
   * (9router's cx/* route adds the Codex CLI prompt, ~2,500 tokens, only to requests without a system message, which
   * a Judge request always has; measured 2026-11-21.)
   */
  private calibrated(input: PrepareInput): number | undefined {
    const anchor = this.anchor
    const items = this.view
    if (anchor === undefined || anchor.itemIds.length > items.length) return undefined
    if (anchor.itemIds.some((id, index) => items[index]?.id !== id)) return undefined
    const changed = anchor.itemTokens.reduce((sum, tokens, index) => sum + estimateTokens(items[index]!.content) - tokens, 0)
    const appended = estimateItemTokens(items.slice(anchor.itemIds.length))
    return Math.max(0, anchor.promptTokens + changed + appended + toolTokens(input.request) - anchor.toolTokens)
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
    if (input.policy.tokenEstimate === "calibrated")
      this.pending = {
        itemIds: items.map((item) => item.id),
        itemTokens: items.map((item) => estimateTokens(item.content)),
        toolTokens: toolTokens(input.request),
      }
    const transformations: Transformation[] = items.flatMap((item, index) => {
      const original = input.items[index]!
      if (item === original || this.maskedIds.has(item.id)) return []
      this.maskedIds.add(item.id)
      return [{
        action: "masked" as const,
        targetItemId: item.id,
        tokensBefore: estimateTokens(original.content),
        tokensAfter: estimateTokens(item.content),
        replacementNote: item.content,
      }]
    })
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

/** Deterministic production operations. Input items must already have crossed the sanitizer boundary. */
export class ProductionContextEngine implements ContextEnginePort {
  constructor(private readonly tokenizer: TokenizerPort) {}

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
    if (requestedOutputCap > input.policy.outputReserveTokens || input.modelLimits.maxOutputTokens < requestedOutputCap ||
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
