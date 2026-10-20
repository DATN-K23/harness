import { describe, expect, test } from "bun:test"
import type { ContextItem, ContextPolicy, ModelLimits, RunBudget } from "@harness/protocol"
import { ProductionContextEngine } from "../../src/context/context-engine"
import { createO200kTokenizer } from "../../src/context/o200k-tokenizer"

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

  test("prepares unchanged evidence with o200k allocation and stable content/request digests", async () => {
    const items = [item("instructions", "Inspect this contract", true)]
  const result = await engine.prepare({ items, policy, modelLimits: limits, budget })
    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    expect(result.preparedItems).toEqual(items)
    expect(result.telemetry.tokenizer).toBe("o200k_base")
    expect(result.telemetry.requestDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.telemetry.estimatedInputTokens).toBeGreaterThan(0)
    expect((await engine.prepare({ items, policy, modelLimits: limits, budget })).telemetry.requestDigest)
      .toBe(result.telemetry.requestDigest)
    expect((await engine.prepare({ items: [item("instructions", "Different text", true)], policy, modelLimits: limits, budget })).telemetry.requestDigest)
      .not.toBe(result.telemetry.requestDigest)
  })

  test("fails closed when pinned content plus reserved output cannot fit", async () => {
    const tinyPolicy = { ...policy, windowLimitTokens: 20, outputReserveTokens: 10 }
    const result = await engine.prepare({ items: [item("pinned", "x".repeat(200), true)], policy: tinyPolicy, modelLimits: limits, budget })
    expect(result.status).toBe("stop")
    if (result.status === "stop") expect(result.stopReason).toBe("context_budget")
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
    expect(result.content).toContain("truncated read_file output")
  })
})
