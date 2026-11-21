import { describe, expect, test } from "bun:test"
import {
  PrepareResultSchema,
  type ContextItem,
  type ContextPolicy,
  type ModelLimits,
  type RunBudget,
} from "@harness/protocol"
import {
  FakeContextEngineLabel,
  PassThroughContextEngine,
  ScriptedContextEngine,
  ThresholdContextEngine,
  estimateTokens,
} from "../../src/testing/fake-context-engines"

const policy = (overrides: Partial<ContextPolicy> = {}): ContextPolicy => ({
  policyVersion: "test-policy",
  windowLimitTokens: 1_000,
  outputReserveTokens: 200,
  compactionThreshold: 0.5,
  safetyMarginFactor: 1.2,
  recentWindowTokens: 100,
  toolOutputMaxTokens: 500,
  toolOutputMaxLines: 3,
  maxCompactions: 2,
  flags: {
    enableToolTruncation: true,
    enableObsMasking: false,
    enableSupersedeReads: true,
    enableDropEmpty: true,
    enableLlmCompaction: true,
    enableSessionNote: false,
  },
  ...overrides,
})

const modelLimits: ModelLimits = { maxContextTokens: 1_000, maxOutputTokens: 200, safetyMarginFactor: 1.25 }

const budget = (overrides: Partial<RunBudget> = {}): RunBudget => ({
  totalTokensUsed: 0,
  totalTokenLimit: 100_000,
  compactionsCount: 0,
  costUsd: 0,
  ...overrides,
})

const item = (id: string, characters: number, extra: Partial<ContextItem> = {}): ContextItem => ({
  id,
  turn: 0,
  type: "tool_result",
  isPinned: false,
  content: "x".repeat(characters),
  ...extra,
})

const input = (items: ContextItem[], overrides: { policy?: ContextPolicy; budget?: RunBudget } = {}) => ({
  items,
  policy: overrides.policy ?? policy(),
  modelLimits,
  budget: overrides.budget ?? budget(),
})

describe("estimateTokens", () => {
  test("is ceil(characters / 4)", () => {
    expect([0, 1, 4, 5, 400].map((length) => estimateTokens("a".repeat(length)))).toEqual([0, 1, 1, 2, 100])
  })
})

describe("PassThroughContextEngine", () => {
  test("is ready with the items unchanged and valid telemetry", async () => {
    const engine = new PassThroughContextEngine()
    const items = [item("a", 400), item("b", 40)]
    const result = await engine.prepare(input(items))
    expect(PrepareResultSchema.safeParse(result).success).toBe(true)
    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    expect(result.preparedItems).toEqual(items)
    expect(result.telemetry).toMatchObject({
      tokenizer: "o200k_base",
      policyVersion: "test-policy",
      estimatedInputTokens: 110,
      estimatedSafetyTokens: 28,
      windowLimitTokens: 1_000,
      outputReserveTokens: 200,
      tokensSaved: 0,
      budgetRemainingTokens: 100_000,
    })
  })

  test("the content digest is deterministic and follows the content", async () => {
    const engine = new PassThroughContextEngine()
    const digestOf = async (items: ContextItem[]) => (await engine.prepare(input(items))).telemetry.contentDigest
    const same = await digestOf([item("a", 8)])
    expect(same).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(await digestOf([item("a", 8)])).toBe(same)
    expect(await digestOf([item("a", 9)])).not.toBe(same)
  })

  test("is labelled as a non-authoritative stand-in", () => {
    const engine = new PassThroughContextEngine()
    expect(engine.nonAuthoritative).toBe(true)
    expect(engine.label).toBe(FakeContextEngineLabel)
    expect(engine.label).toContain("NOT the authoritative o200k_base count")
  })

  test("logs each prepare call", async () => {
    const engine = new PassThroughContextEngine()
    await engine.prepare(input([item("a", 4)]))
    await engine.prepare(input([item("a", 4), item("b", 4)]))
    expect(engine.prepareCalls.map((call) => call.items.length)).toEqual([1, 2])
  })

  test("record adds the reported usage and compares the prompt tokens with the last estimate", async () => {
    const engine = new PassThroughContextEngine()
    await engine.prepare(input([item("a", 400)]))
    const recorded = await engine.record({
      actualUsage: { promptTokens: 130, completionTokens: 20, totalTokens: 150 },
      modelLimits,
      budget: budget({ totalTokensUsed: 1_000 }),
    })
    expect(recorded).toEqual({ totalTokensUsed: 1_150, tokenDelta: 30, suggestedSafetyMargin: 1.25 })
  })
})

describe("shapeToolResult (fake truncation)", () => {
  const engine = new PassThroughContextEngine()
  const output = ["one", "two", "three", "four", "five"].join("\n")

  test("truncates by line count and appends a continuation note", async () => {
    const shaped = await engine.shapeToolResult({ content: output, toolName: "grep", policy: policy() })
    expect(shaped.isTruncated).toBe(true)
    expect(shaped.continuationNote).toContain("showing 3 of 5 lines")
    expect(shaped.content.split("\n")).toEqual(["one", "two", "three", shaped.continuationNote ?? ""])
    expect(shaped.shownLines).toBe(3)
    expect(shaped.tokensBefore).toBe(estimateTokens(output))
    expect(shaped.tokensAfter).toBe(estimateTokens(shaped.content))
  })

  test("decides whether to truncate using the original line count", async () => {
    const shaped = await engine.shapeToolResult({ content: "one\ntwo\nthree\nfour", toolName: "grep", policy: policy() })
    expect(shaped.isTruncated).toBe(true)
    expect(shaped.continuationNote).toContain("showing 3 of 4 lines")
  })

  test("leaves short output alone", async () => {
    const shaped = await engine.shapeToolResult({ content: "a\nb\nc", toolName: "grep", policy: policy() })
    expect(shaped).toEqual({ content: "a\nb\nc", isTruncated: false, tokensBefore: 2, tokensAfter: 2 })
  })

  test("leaves long output alone when truncation is disabled", async () => {
    const off = policy({ flags: { ...policy().flags, enableToolTruncation: false } })
    const shaped = await engine.shapeToolResult({ content: output, toolName: "grep", policy: off })
    expect(shaped.isTruncated).toBe(false)
    expect(shaped.content).toBe(output)
  })
})

describe("ThresholdContextEngine", () => {
  const engine = () => new ThresholdContextEngine()

  test("is ready at or below the compaction threshold", async () => {
    // room = 800, threshold 0.5 -> 400 tokens
    const result = await engine().prepare(input([item("a", 1_600)]))
    expect(result.status).toBe("ready")
  })

  test("asks for compaction above the threshold, never touching pinned or recent items", async () => {
    const items = [item("pinned", 800, { isPinned: true }), item("old", 800), item("old-2", 400), item("recent", 400)]
    const result = await engine().prepare(input(items))
    expect(PrepareResultSchema.safeParse(result).success).toBe(true)
    expect(result.status).toBe("needs_compaction")
    if (result.status !== "needs_compaction") return
    expect(result.itemsToSummarize.map((candidate) => candidate.id)).toEqual(["old", "old-2"])
    expect(result.summaryPrompt.length).toBeGreaterThan(0)
  })

  test("never asks for a compaction that cannot get under the threshold", async () => {
    // threshold 400; pinned 500 + recent 100 stay even after an empty summary, so summarizing "old" cannot help.
    const items = [item("pinned", 2_000, { isPinned: true }), item("old", 400), item("recent", 400)]
    expect((await engine().prepare(input(items))).status).toBe("ready")
    const overRoom = [item("pinned", 3_200, { isPinned: true }), item("old", 400), item("recent", 400)]
    expect(await engine().prepare(input(overRoom))).toMatchObject({ status: "stop", stopReason: "context_budget" })
  })

  test("keeps a tool call and its result together when the recent window splits them", async () => {
    const call = (id: string, callId: string, characters: number) =>
      item(id, characters, { type: "tool_request", toolMeta: { callId, toolName: "read_file" } })
    const result = (id: string, callId: string, characters: number) =>
      item(id, characters, { toolMeta: { callId, toolName: "read_file" } })
    // The recent window (100 tokens) holds only the last result, so c2's call would be summarized without it.
    const items = [call("req-1", "c1", 400), result("res-1", "c1", 800), call("req-2", "c2", 40), result("res-2", "c2", 400)]
    const prepared = await engine().prepare(input(items))
    if (prepared.status !== "needs_compaction") throw new Error("expected needs_compaction")
    expect(prepared.itemsToSummarize.map((candidate) => candidate.id)).toEqual(["req-1", "res-1"])
  })

  test("stops with context_budget when over the room and compaction is unavailable", async () => {
    const items = [item("a", 2_000), item("b", 2_000)]
    const exhausted = await engine().prepare(input(items, { budget: budget({ compactionsCount: 2 }) }))
    const disabled = await engine().prepare(
      input(items, { policy: policy({ flags: { ...policy().flags, enableLlmCompaction: false } }) }),
    )
    expect(exhausted).toMatchObject({ status: "stop", stopReason: "context_budget" })
    expect(disabled).toMatchObject({ status: "stop", stopReason: "context_budget" })
    expect(PrepareResultSchema.safeParse(exhausted).success).toBe(true)
  })

  test("stays ready between the threshold and the room when compaction is unavailable", async () => {
    const result = await engine().prepare(input([item("a", 2_400)], { budget: budget({ compactionsCount: 2 }) }))
    expect(result.status).toBe("ready")
  })

  test("stops with total_tokens when the estimate would pass the total token limit", async () => {
    const result = await engine().prepare(
      input([item("a", 400)], { budget: budget({ totalTokensUsed: 950, totalTokenLimit: 1_000 }) }),
    )
    expect(result).toMatchObject({ status: "stop", stopReason: "total_tokens" })
  })
})

describe("calibrated token estimate", () => {
  const calibrated = policy({ tokenEstimate: "calibrated" })
  const usage = (promptTokens: number) => ({ promptTokens, completionTokens: 5, totalTokens: promptTokens + 5 })
  const record = (engine: PassThroughContextEngine, promptTokens: number) =>
    engine.record({ actualUsage: usage(promptTokens), modelLimits, budget: budget() })
  const tools = (description: string) => [{ name: "read_file", description, parameters: {} }]
  const withTools = (items: ContextItem[], description: string) => ({
    ...input(items, { policy: calibrated }),
    request: { attemptIndex: 1, runId: "run", stepIndex: 1, profileId: "p", items, tools: tools(description) },
  })

  test("starts from the real prompt count of the previous request and adds only what was appended", async () => {
    const engine = new PassThroughContextEngine()
    const first = await engine.prepare(input([item("a", 400)], { policy: calibrated }))
    expect(first.telemetry.estimatedInputTokens).toBe(100)
    await record(engine, 2_600)
    const next = await engine.prepare(input([item("a", 400), item("b", 40)], { policy: calibrated }))
    expect(next.telemetry.estimatedInputTokens).toBe(2_610)
  })

  test("follows a change in the tool definitions sent with the request", async () => {
    const engine = new PassThroughContextEngine()
    await engine.prepare(withTools([item("a", 400)], "x".repeat(40)))
    await record(engine, 2_000)
    const fewerTools = await engine.prepare(withTools([item("a", 400)], ""))
    const removed = estimateTokens(JSON.stringify(tools("x".repeat(40)))) - estimateTokens(JSON.stringify(tools("")))
    expect(fewerTools.telemetry.estimatedInputTokens).toBe(2_000 - removed)
  })

  test("anchors on the request really sent: an added instruction and disabled tools leave the anchor", async () => {
    const engine = new PassThroughContextEngine()
    const prepared = withTools([item("a", 400)], "x".repeat(40))
    await engine.prepare(prepared)
    const instruction = item("forced", 40, { type: "harness_instruction" })
    await engine.record({
      actualUsage: usage(2_000),
      modelLimits,
      budget: budget(),
      request: { ...prepared.request, items: [item("a", 400), instruction], toolsDisabled: true },
    })
    const next = await engine.prepare(withTools([item("a", 400), item("b", 40)], "x".repeat(40)))
    // 2,000 real - 10 for the instruction (not in the history) + 10 appended + the tools sent again (none were sent).
    expect(next.telemetry.estimatedInputTokens).toBe(2_000 - 10 + 10 + estimateTokens(JSON.stringify(tools("x".repeat(40)))))
  })

  test("falls back to characters when the items no longer extend the anchored request", async () => {
    const engine = new PassThroughContextEngine()
    await engine.prepare(input([item("a", 400), item("b", 400)], { policy: calibrated }))
    await record(engine, 5_000)
    const compacted = await engine.prepare(input([item("summary", 40), item("b", 400)], { policy: calibrated }))
    expect(compacted.telemetry.estimatedInputTokens).toBe(110)
  })

  test("keeps the previous anchor when the provider reports no prompt count", async () => {
    const engine = new PassThroughContextEngine()
    await engine.prepare(input([item("a", 400)], { policy: calibrated }))
    await record(engine, 2_600)
    await engine.prepare(input([item("a", 400), item("b", 40)], { policy: calibrated }))
    await record(engine, 0)
    const next = await engine.prepare(input([item("a", 400), item("b", 40), item("c", 40)], { policy: calibrated }))
    expect(next.telemetry.estimatedInputTokens).toBe(2_620)
  })

  test("never anchors on a compaction call or on a policy that does not ask for it", async () => {
    const threshold = new ThresholdContextEngine()
    const needs = await threshold.prepare(input([item("old", 2_000), item("recent", 400)], { policy: calibrated }))
    expect(needs.status).toBe("needs_compaction")
    await threshold.record({ actualUsage: usage(9_999), modelLimits, budget: budget() })
    expect((await threshold.prepare(input([item("a", 40)], { policy: calibrated }))).telemetry.estimatedInputTokens).toBe(10)

    const characters = new PassThroughContextEngine()
    await characters.prepare(input([item("a", 400)]))
    await record(characters, 2_600)
    expect((await characters.prepare(input([item("a", 400), item("b", 40)]))).telemetry.estimatedInputTokens).toBe(110)
  })
})

describe("observation masking", () => {
  const masking = (overrides: Partial<ContextPolicy> = {}) =>
    policy({ ...overrides, flags: { ...policy().flags, enableObsMasking: true } })
  const read = item("read", 2_000, {
    toolMeta: { callId: "c1", toolName: "read_file", filePath: "src/Vault.sol", lineRange: [1, 50] },
  })
  const history = [
    read,
    item("pinned", 2_000, { isPinned: true }),
    item("finding", 2_000, { type: "candidate_finding" }),
    item("recent", 400),
  ]
  const request = (items: ContextItem[]) => ({ attemptIndex: 1, runId: "run", stepIndex: 1, profileId: "p", items })

  test("hides only unpinned tool results behind the recent window, once reported, history untouched", async () => {
    const engine = new PassThroughContextEngine()
    const first = await engine.prepare({ ...input(history, { policy: masking() }), request: request(history) })
    if (first.status !== "ready") throw new Error("expected ready")
    const note = "[earlier read_file result for src/Vault.sol lines 1-50 hidden to save context (1 lines); call the tool again if you need it]"
    expect(first.preparedItems.map((sent) => sent.content)).toEqual([note, ...history.slice(1).map((kept) => kept.content)])
    expect(first.preparedItems[0]!.toolMeta).toEqual(read.toolMeta)
    expect(first.preparedRequest?.items).toEqual(first.preparedItems)
    expect(first.transformations).toEqual([
      { action: "masked", targetItemId: "read", tokensBefore: 500, tokensAfter: estimateTokens(note), replacementNote: note },
    ])
    expect(first.telemetry.tokensSaved).toBe(500 - estimateTokens(note))
    expect(first.telemetry.estimatedInputTokens).toBe(1_100 + estimateTokens(note))
    expect(history[0]!.content).toHaveLength(2_000)
    expect(PrepareResultSchema.safeParse(first).success).toBe(true)

    const again = await engine.prepare({ ...input(history, { policy: masking() }), request: request(history) })
    expect(again.transformations).toBeUndefined()
    expect(again.status === "ready" && again.preparedItems[0]!.content).toBe(note)
  })

  test("sends the history unchanged when the flag is off", async () => {
    const off = policy()
    const sent = request(history)
    const result = await new PassThroughContextEngine().prepare({ ...input(history, { policy: off }), request: sent })
    expect(result.status === "ready" && result.preparedItems).toBe(history)
    expect(result.status === "ready" && result.preparedRequest).toBe(sent)
    expect(result.transformations).toBeUndefined()
    expect(result.telemetry.tokensSaved).toBe(0)
  })

  test("the compaction decision sees the masked request, so masking that fits avoids a summary call", async () => {
    // Unmasked: 500 + 100 = 600 tokens, over the 0.5 x (1,000 - 200) = 400 threshold; masked it fits.
    const items = [read, item("recent", 400)]
    expect((await new ThresholdContextEngine().prepare(input(items))).status).toBe("needs_compaction")
    expect((await new ThresholdContextEngine().prepare(input(items, { policy: masking() }))).status).toBe("ready")
  })

  test("a calibrated estimate subtracts what masking removed since the anchored request", async () => {
    const calibrated = masking({ tokenEstimate: "calibrated", recentWindowTokens: 200 })
    const engine = new PassThroughContextEngine()
    await engine.prepare(input([read, item("recent", 400)], { policy: calibrated }))
    await engine.record({ actualUsage: { promptTokens: 3_000, completionTokens: 1, totalTokens: 3_001 }, modelLimits, budget: budget() })
    // The new 400-character result pushes the read behind the 200-token recent window, so it is masked now.
    const next = await engine.prepare(input([read, item("recent", 400), item("newer", 400)], { policy: calibrated }))
    const note = next.status === "ready" ? next.preparedItems[0]!.content : ""
    expect(next.telemetry.estimatedInputTokens).toBe(3_000 - 500 + estimateTokens(note) + 100)
  })
})

describe("ScriptedContextEngine", () => {
  const items = [item("a", 40)]

  test("plays one scripted result per call, filling telemetry when the entry omits it", async () => {
    const engine = new ScriptedContextEngine([
      { status: "needs_compaction", summaryPrompt: "summarize", itemsToSummarize: items },
      { status: "stop", stopReason: "context_budget" },
    ])
    const first = await engine.prepare(input(items))
    const second = await engine.prepare(input(items))
    expect(first).toMatchObject({ status: "needs_compaction", summaryPrompt: "summarize", itemsToSummarize: items })
    expect(second).toMatchObject({ status: "stop", stopReason: "context_budget" })
    expect(first.telemetry.estimatedInputTokens).toBe(10)
    expect(PrepareResultSchema.safeParse(first).success).toBe(true)
  })

  test("keeps scripted telemetry and transformations verbatim", async () => {
    const telemetry = {
      tokenizer: "o200k_base" as const,
      policyVersion: "scripted",
      estimatedInputTokens: 7,
      estimatedSafetyTokens: 1,
      windowLimitTokens: 100,
      outputReserveTokens: 10,
      tokensSaved: 5,
      budgetRemainingTokens: 50,
      contentDigest: "sha256:scripted",
    }
    const transformations = [
      { action: "masked" as const, targetItemId: "a", tokensBefore: 12, tokensAfter: 7, replacementNote: "masked" },
    ]
    const engine = new ScriptedContextEngine([{ status: "ready", preparedItems: [], transformations, telemetry }])
    expect(await engine.prepare(input(items))).toEqual({
      status: "ready",
      preparedItems: [],
      transformations,
      telemetry,
    })
  })

  test("a function entry sees the input and the engine passes through once the script ends", async () => {
    const engine = new ScriptedContextEngine([(call) => ({ status: "ready", preparedItems: call.items.slice(0, 1) })])
    const many = [item("a", 4), item("b", 4)]
    const first = await engine.prepare(input(many))
    const second = await engine.prepare(input(many))
    expect(first.status === "ready" && first.preparedItems.map((kept) => kept.id)).toEqual(["a"])
    expect(second.status === "ready" && second.preparedItems.map((kept) => kept.id)).toEqual(["a", "b"])
    expect(engine.prepareCalls).toHaveLength(2)
  })

  test("is labelled as non-authoritative", () => {
    expect(new ScriptedContextEngine([]).nonAuthoritative).toBe(true)
    expect(new ThresholdContextEngine().label).toBe(FakeContextEngineLabel)
  })
})
