import { describe, expect, test } from "bun:test"
import type { ContextItem, ContextPolicy, ModelLimits, RunBudget } from "@harness/protocol"
import { ProductionContextEngine } from "../../src/context/context-engine"
import { createO200kTokenizer } from "../../src/context/o200k-tokenizer"
import { PrepareResultSchema } from "@harness/protocol"

const policy: ContextPolicy = {
  policyVersion: "sprint-6-v1", windowLimitTokens: 16384, outputReserveTokens: 4096,
  compactionThreshold: 0.8, safetyMarginFactor: 1.2, recentWindowTokens: 4096,
  toolOutputMaxTokens: 100, toolOutputMaxLines: 100, maxCompactions: 0,
  flags: { enableToolTruncation: true, enableObsMasking: false, enableSupersedeReads: false,
    enableDropEmpty: false, enableLlmCompaction: false, enableSessionNote: false },
}
const limits: ModelLimits = { maxContextTokens: 32768, maxOutputTokens: 8192, safetyMarginFactor: 1.2 }
const budget: RunBudget = { totalTokensUsed: 10, totalTokenLimit: 20000, compactionsCount: 0, costUsd: 0, costCeilingUsd: 1 }
const item = (id: string, content: string, isPinned = false): ContextItem => ({ id, turn: 0, type: "system_prompt", isPinned, content })

describe("ProductionContextEngine", () => {
  const engine = new ProductionContextEngine(createO200kTokenizer())
  const requestFor = (items: ContextItem[]) => ({ runId: "run", stepIndex: 1, attemptIndex: 1, profileId: "model", items })

  test("prepares unchanged evidence with o200k allocation and stable content/request digests", async () => {
    const items = [item("instructions", "Inspect this contract", true)]
    const result = await engine.prepare({ items, request: requestFor(items), policy, modelLimits: limits, budget })
    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    expect(result.preparedItems).toEqual(items)
    expect(result.telemetry.tokenizer).toBe("o200k_base")
    expect(result.telemetry.requestDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.telemetry.estimatedInputTokens).toBeGreaterThan(0)
    expect((await engine.prepare({ items, request: requestFor(items), policy, modelLimits: limits, budget })).telemetry.requestDigest)
      .toBe(result.telemetry.requestDigest)
    const differentItems = [item("instructions", "Different text", true)]
    expect((await engine.prepare({ items: differentItems, request: requestFor(differentItems), policy, modelLimits: limits, budget })).telemetry.requestDigest)
      .not.toBe(result.telemetry.requestDigest)
  })

  test("rejects an explicit output cap larger than the shared reserve before sending", async () => {
    const items = [item("safe", "ok")]
    const result = await engine.prepare({ items, request: { ...requestFor(items), maxOutputTokens: 4097 }, policy, modelLimits: { ...limits, maxOutputTokens: 8192 }, budget })
    expect(result.status).toBe("stop")
  })

  test("smaller explicit output cap becomes the effective reserve", async () => {
    const items = [item("small", "ok")]
    const result = await engine.prepare({ items, request: { ...requestFor(items), maxOutputTokens: 16 }, policy, modelLimits: limits, budget })
    expect(result.status).toBe("ready")
    expect(result.telemetry.outputReserveTokens).toBe(16)
  })

  test("rejects malformed runtime profiles before allocating context", async () => {
    const items = [item("safe", "ok")]
    const invalidInputs = [
      { policy: { ...policy, safetyMarginFactor: Number.NaN } },
      { policy: { ...policy, outputReserveTokens: -1 } },
      { policy: { ...policy, windowLimitTokens: 0 } },
      { modelLimits: { ...limits, maxOutputTokens: 0 } },
      { modelLimits: { ...limits, maxContextTokens: 10, maxOutputTokens: 20 } },
      { budget: { ...budget, totalTokenLimit: 0 } },
    ]
    for (const invalid of invalidInputs) {
      const result = await engine.prepare({ items, request: requestFor(items), policy, modelLimits: limits, budget, ...invalid } as never)
      expect(result.status).toBe("stop")
      expect(PrepareResultSchema.safeParse(result).success).toBe(true)
    }
  })

  test("rejects output caps beyond the model limit and reserves the exact smaller request cap", async () => {
    const items = [item("small", "ok")]
    const tooLarge = await engine.prepare({ items, request: { ...requestFor(items), maxOutputTokens: 9 }, policy: { ...policy, outputReserveTokens: 16 }, modelLimits: { ...limits, maxOutputTokens: 8 }, budget })
    expect(tooLarge.status).toBe("stop")
    const smaller = await engine.prepare({ items, request: { ...requestFor(items), maxOutputTokens: 4 }, policy: { ...policy, outputReserveTokens: 16 }, modelLimits: limits, budget })
    expect(smaller.telemetry.outputReserveTokens).toBe(4)
  })

  test("fails closed when pinned content plus reserved output cannot fit", async () => {
    const tinyPolicy = { ...policy, windowLimitTokens: 20, outputReserveTokens: 10 }
    const items = [item("pinned", "x".repeat(200), true)]
    const result = await engine.prepare({ items, request: requestFor(items), policy: tinyPolicy, modelLimits: limits, budget })
    expect(result.status).toBe("stop")
    if (result.status === "stop") expect(result.stopReason).toBe("context_budget")
  })

  test("uses the effective model window instead of rejecting its smaller hard context limit", async () => {
    const modelLimits = { ...limits, maxContextTokens: 10_000 }
    const roomyPolicy = { ...policy, windowLimitTokens: 16_384 }
    const smallItems = [item("small", "ok")]
    const ready = await engine.prepare({ items: smallItems, request: requestFor(smallItems), policy: roomyPolicy, modelLimits, budget })
    expect(ready.status).toBe("ready")

    const nearCapacity = [item("large", "x".repeat(5_000))]
    const estimate = createO200kTokenizer().count(JSON.stringify(nearCapacity))
    const oneOverLimits = { ...modelLimits, maxContextTokens: estimate + Math.ceil(estimate * 0.2) + 4095 }
    const stopped = await engine.prepare({ items: nearCapacity, request: requestFor(nearCapacity), policy: roomyPolicy, modelLimits: oneOverLimits, budget })
    expect(stopped.status).toBe("stop")
  })

  test("accepts a request exactly at effective context capacity", async () => {
    const items = [item("exact", "ok")]
    const tokenizer = createO200kTokenizer()
    const estimate = tokenizer.count(JSON.stringify(requestFor(items)))
    const safety = Math.ceil(estimate * 0.2)
    const outputReserveTokens = 10
    const exactWindow = estimate + safety + outputReserveTokens
    const result = await engine.prepare({
      items,
      request: requestFor(items),
      policy: { ...policy, windowLimitTokens: exactWindow, outputReserveTokens },
      modelLimits: { ...limits, maxContextTokens: exactWindow, maxOutputTokens: outputReserveTokens },
      budget: { ...budget, totalTokenLimit: exactWindow + budget.totalTokensUsed },
    })
    expect(result.status).toBe("ready")
  })

  test("enforces the line bound even when token capacity remains", async () => {
    const result = await engine.shapeToolResult({ content: "a\nb\nc", toolName: "read_file", policy: { ...policy, toolOutputMaxTokens: 200, toolOutputMaxLines: 2 } })
    expect(result.isTruncated).toBe(true)
    expect(result.content.split("\n").filter((line) => !line.startsWith("[truncated")).length).toBeLessThanOrEqual(2)
    expect(createO200kTokenizer().count(result.content)).toBeLessThanOrEqual(200)
  })

  test("never exceeds the output token cap when continuation text cannot fit", async () => {
    const tinyPolicy = { ...policy, toolOutputMaxTokens: 1, toolOutputMaxLines: 10 }
    const result = await engine.shapeToolResult({ content: "an exceptionally long first line", toolName: "read_file", policy: tinyPolicy })
    expect(createO200kTokenizer().count(result.content)).toBeLessThanOrEqual(1)
    expect(result.continuationNote).toContain("truncated read_file output")
  })

  test("includes continuation text inside the token cap when it can fit", async () => {
    const tokenizer = createO200kTokenizer()
    const cap = tokenizer.count("[truncated read_file output: showing 1 of 2 lines; continue with a narrower read]")
    const result = await engine.shapeToolResult({ content: "a\nb", toolName: "read_file", policy: { ...policy, toolOutputMaxTokens: cap, toolOutputMaxLines: 1 } })
    expect(tokenizer.count(result.content)).toBeLessThanOrEqual(cap)
    expect(result.continuationNote).toContain("truncated read_file output")
  })

  test("keeps content unchanged when truncation is disabled", async () => {
    const content = "first\nsecond\nthird"
    const result = await engine.shapeToolResult({ content, toolName: "read_file", policy: { ...policy, flags: { ...policy.flags, enableToolTruncation: false }, toolOutputMaxLines: 1, toolOutputMaxTokens: 1 } })
    expect(result.content).toBe(content)
    expect(result.isTruncated).toBe(false)
  })

  test("records provider usage without retaining state and keeps usage delta signed", async () => {
    const result = await engine.record({ actualUsage: { promptTokens: 9, completionTokens: 4, totalTokens: 13 }, modelLimits: limits, budget })
    expect(result.totalTokensUsed).toBe(23)
    expect(result.tokenDelta).toBe(9)
    expect((await engine.record({ actualUsage: { promptTokens: 9, completionTokens: 4, totalTokens: 13 }, modelLimits: limits, budget })).tokenDelta)
      .toBe(9)
  })

  test("shapes sanitized tool output to a contiguous line prefix with continuation metadata", async () => {
    const result = await engine.shapeToolResult({ content: "line 1\nline 2\nline 3", toolName: "read_file", policy: { ...policy, toolOutputMaxTokens: 1 } })
    expect(result.isTruncated).toBe(true)
    expect(result.continuationNote).toContain("truncated read_file output")
  })

  test("read_file continuation identifies safe relative path and next line", async () => {
    const tokenizer = createO200kTokenizer()
    const marker = "[truncated read_file output: showing 1 of 3 lines; read contracts/Vault.sol from line 2]"
    const result = await engine.shapeToolResult({ content: "a\nb\nc", toolName: "read_file", path: "contracts/Vault.sol", lineRange: [1, 3], policy: { ...policy, toolOutputMaxTokens: tokenizer.count(marker) + tokenizer.count("a\n"), toolOutputMaxLines: 1 } })
    expect(result.continuationNote).toContain("contracts/Vault.sol from line 2")
    expect(tokenizer.count(result.content)).toBeLessThanOrEqual(tokenizer.count(marker) + tokenizer.count("a\n"))
  })
})
