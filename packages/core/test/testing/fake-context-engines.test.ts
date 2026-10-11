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
  recentWindowTokens: 100,
  toolOutputMaxTokens: 500,
  toolOutputMaxLines: 3,
  maxCompactions: 2,
  flags: {
    enableToolTruncation: true,
    enableObsMasking: true,
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
  costCeilingUsd: 10,
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
    expect(shaped.tokensBefore).toBe(estimateTokens(output))
    expect(shaped.tokensAfter).toBe(estimateTokens(shaped.content))
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
