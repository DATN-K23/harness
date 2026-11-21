import type { ContextItem, ContextPolicy, ModelAttemptRequest, PrepareResult, TokenUsage } from "@harness/protocol"
import { estimateTokens } from "./token-estimator"

/** The instruction sent with the items a compaction summarizes. */
export const CompactionSummaryPrompt = "Summarize these context items, keeping every finding and file reference."

/** Counts the tokens of a text; each engine passes its own (characters over four, or the o200k tokenizer). */
export type CountTokens = (text: string) => number

type Transformation = NonNullable<PrepareResult["transformations"]>[number]

const countItems = (items: readonly ContextItem[], count: CountTokens) =>
  items.reduce((total, item) => total + count(item.content), 0)

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
export const maskOldToolResults = (
  items: readonly ContextItem[],
  policy: ContextPolicy,
  count: CountTokens = estimateTokens,
): ContextItem[] => {
  if (!policy.flags.enableObsMasking) return [...items]
  let newer = 0
  return items
    .toReversed()
    .map((item) => {
      const old = newer >= policy.recentWindowTokens
      newer += count(item.content)
      if (!old || item.isPinned || item.type !== "tool_result") return item
      const content = maskNote(item)
      return content.length < item.content.length ? { ...item, content } : item
    })
    .toReversed()
}

/** Reports each masked item once, as a `masked` transformation, not on every later step that still hides it. */
export class MaskReport {
  private readonly reported = new Set<string>()

  constructor(private readonly count: CountTokens) {}

  newlyMasked(history: readonly ContextItem[], view: readonly ContextItem[]): Transformation[] {
    return view.flatMap((item, index) => {
      const original = history[index]!
      if (item === original || this.reported.has(item.id)) return []
      this.reported.add(item.id)
      return [{
        action: "masked" as const,
        targetItemId: item.id,
        tokensBefore: this.count(original.content),
        tokensAfter: this.count(item.content),
        replacementNote: item.content,
      }]
    })
  }
}

/** What a ready request held, so the provider's real prompt count for it can anchor the next estimate. */
interface SentShape {
  itemIds: string[]
  /** Tokens of each item as sent, so a later change to it (masking) can be added to the real count. */
  itemTokens: number[]
  toolTokens: number
}

/**
 * The `calibrated` estimate: the provider's real prompt count of the last request plus a local count of what changed
 * since (items appended, earlier items now sent shorter, the difference in tool definitions). Undefined without a real
 * count, or when the items no longer extend that request (a compaction replaced some), so the engine falls back to its
 * own count. The real count also holds any prompt a router adds; only the first request, counted locally, misses it.
 * (9router's cx/* route adds the Codex CLI prompt, ~2,500 tokens, only to requests without a system message, which a
 * Judge request always has; measured 2026-11-21.)
 */
export class PromptCalibration {
  /** The last ready request, waiting for its real usage in `record`. */
  private pending: SentShape | undefined
  /** The latest request whose real prompt count the provider reported. */
  private anchor: (SentShape & { promptTokens: number }) | undefined

  constructor(private readonly count: CountTokens) {}

  /** Tokens of the tool definitions a request sends; a request with tools disabled sends none. */
  private toolTokens(request: ModelAttemptRequest | undefined) {
    return request?.tools === undefined || request.toolsDisabled === true ? 0 : this.count(JSON.stringify(request.tools))
  }

  /** A new `prepare` starts: a request that never reached the provider leaves nothing to anchor. */
  begin() {
    this.pending = undefined
  }

  estimate(view: readonly ContextItem[], request: ModelAttemptRequest | undefined): number | undefined {
    const anchor = this.anchor
    if (anchor === undefined || anchor.itemIds.length > view.length) return undefined
    if (anchor.itemIds.some((id, index) => view[index]?.id !== id)) return undefined
    const changed = anchor.itemTokens.reduce((sum, tokens, index) => sum + this.count(view[index]!.content) - tokens, 0)
    const appended = countItems(view.slice(anchor.itemIds.length), this.count)
    return Math.max(0, anchor.promptTokens + changed + appended + this.toolTokens(request) - anchor.toolTokens)
  }

  /** The engine returned `ready` for this view; its real usage arrives in `record`. */
  sent(view: readonly ContextItem[], request: ModelAttemptRequest | undefined) {
    this.pending = {
      itemIds: view.map((item) => item.id),
      itemTokens: view.map((item) => this.count(item.content)),
      toolTokens: this.toolTokens(request),
    }
  }

  /**
   * Anchors on the real usage. Usage of a compaction call has no pending shape (its prepare was not ready), so it never
   * becomes the anchor. Without the sent request, what the runner adds after `prepare` stays in the anchor and the next
   * estimate runs a few hundred tokens high.
   */
  record(usage: TokenUsage | null, sent: ModelAttemptRequest | undefined) {
    if (this.pending !== undefined && usage !== null && usage.promptTokens > 0) {
      const prepared = new Set(this.pending.itemIds)
      // Items the runner added after `prepare` (a forced step's instruction) are in the real count but not in the
      // history the next request extends, so they leave the anchor; its tools are the ones really sent.
      const added = sent === undefined ? 0 : countItems(sent.items.filter((item) => !prepared.has(item.id)), this.count)
      this.anchor = {
        ...this.pending,
        toolTokens: sent === undefined ? this.pending.toolTokens : this.toolTokens(sent),
        promptTokens: Math.max(0, usage.promptTokens - added),
      }
    }
    this.pending = undefined
  }
}

/**
 * The items an LLM compaction should summarize, or none when it cannot help: unpinned items behind the newest
 * `recentWindowTokens`, with each tool call and its result taken together or not at all (the recent window can split a
 * pair, and a result left without its call is history no provider request can carry). None either when even an empty
 * summary would leave the request over the threshold (a window too small for `recentWindowTokens`).
 */
export const selectItemsToSummarize = (input: {
  history: readonly ContextItem[]
  view: readonly ContextItem[]
  policy: ContextPolicy
  estimate: number
  threshold: number
  count: CountTokens
}): ContextItem[] => {
  const recent = new Set<string>()
  let recentTokens = 0
  for (const item of input.history.toReversed()) {
    if (recentTokens >= input.policy.recentWindowTokens) break
    recent.add(item.id)
    recentTokens += input.count(item.content)
  }
  const older = input.history.filter((item) => !item.isPinned && !recent.has(item.id))
  const candidates = new Set(older.map((item) => item.id))
  const split = new Set(
    input.history
      .filter((item) => item.toolMeta !== undefined && !candidates.has(item.id))
      .map((item) => item.toolMeta!.callId),
  )
  const chosen = older.filter((item) => item.toolMeta === undefined || !split.has(item.toolMeta.callId))
  const ids = new Set(chosen.map((item) => item.id))
  const freed = countItems(input.view.filter((item) => ids.has(item.id)), input.count)
  return chosen.length > 0 && input.estimate - freed <= input.threshold ? chosen : []
}
