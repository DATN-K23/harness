import { describe, expect, test } from "bun:test"
import {
  ContextItemSchema,
  ContextItemTypes,
  PrepareResultSchema,
  selectPinnedItems,
  type ContextItem,
} from "../src/context"

const item = (overrides: Partial<ContextItem> = {}): ContextItem => ({
  id: "item-1",
  turn: 0,
  type: "assistant_reasoning",
  isPinned: false,
  content: "text",
  ...overrides,
})

const telemetry = {
  tokenizer: "o200k_base",
  policyVersion: "v1",
  estimatedInputTokens: 100,
  estimatedSafetyTokens: 110,
  windowLimitTokens: 1000,
  outputReserveTokens: 100,
  tokensSaved: 0,
  budgetRemainingTokens: 900,
  contentDigest: "abc",
}

describe("PrepareResultSchema", () => {
  test("accepts ready with preparedItems", () => {
    const result = PrepareResultSchema.safeParse({ status: "ready", preparedItems: [item()], telemetry })
    expect(result.success).toBe(true)
  })

  test("accepts needs_compaction with summaryPrompt and itemsToSummarize", () => {
    const result = PrepareResultSchema.safeParse({
      status: "needs_compaction",
      summaryPrompt: "summarize",
      itemsToSummarize: [item()],
      telemetry,
    })
    expect(result.success).toBe(true)
  })

  test("accepts stop with a stopReason", () => {
    expect(PrepareResultSchema.safeParse({ status: "stop", stopReason: "context_budget", telemetry }).success).toBe(true)
    expect(PrepareResultSchema.safeParse({ status: "stop", stopReason: "total_tokens", telemetry }).success).toBe(true)
  })

  test("accepts all prepare outcomes with optional versioned telemetry while retaining legacy fields", () => {
    const outcomes = [
      { status: "ready", preparedItems: [item()] },
      { status: "needs_compaction", summaryPrompt: "summarize", itemsToSummarize: [item()] },
      { status: "stop", stopReason: "context_budget" },
    ] as const
    for (const outcome of outcomes) {
      expect(PrepareResultSchema.safeParse({ ...outcome, telemetry }).success).toBe(true)
    }
  })

  test("rejects an unknown status", () => {
    const result = PrepareResultSchema.safeParse({ status: "retry", preparedItems: [item()], telemetry })
    expect(result.success).toBe(false)
  })

  test("rejects a missing status", () => {
    expect(PrepareResultSchema.safeParse({ preparedItems: [item()], telemetry }).success).toBe(false)
  })

  test("rejects stop without a stopReason or with an unknown one", () => {
    expect(PrepareResultSchema.safeParse({ status: "stop", telemetry }).success).toBe(false)
    expect(PrepareResultSchema.safeParse({ status: "stop", stopReason: "wall_clock", telemetry }).success).toBe(false)
  })

  test("rejects needs_compaction without summaryPrompt or itemsToSummarize", () => {
    expect(
      PrepareResultSchema.safeParse({ status: "needs_compaction", itemsToSummarize: [item()], telemetry }).success,
    ).toBe(false)
    expect(
      PrepareResultSchema.safeParse({ status: "needs_compaction", summaryPrompt: "s", telemetry }).success,
    ).toBe(false)
  })

  test("rejects ready without preparedItems", () => {
    expect(PrepareResultSchema.safeParse({ status: "ready", telemetry }).success).toBe(false)
  })

  test("rejects a response without telemetry", () => {
    expect(PrepareResultSchema.safeParse({ status: "ready", preparedItems: [item()] }).success).toBe(false)
  })

  test("accepts transformations and rejects an unknown action", () => {
    const transformation = {
      action: "masked",
      targetItemId: "item-1",
      tokensBefore: 10,
      tokensAfter: 2,
      replacementNote: "[masked]",
    }
    const ok = PrepareResultSchema.safeParse({
      status: "ready",
      preparedItems: [item()],
      transformations: [transformation],
      telemetry,
    })
    expect(ok.success).toBe(true)
    const bad = PrepareResultSchema.safeParse({
      status: "ready",
      preparedItems: [item()],
      transformations: [{ ...transformation, action: "deleted" }],
      telemetry,
    })
    expect(bad.success).toBe(false)
  })

  test("accepts tool output truncation with integer counts and rejects invalid token counts", () => {
    const base = { status: "ready", preparedItems: [item()], telemetry }
    const transformation = {
      action: "tool_output_truncated",
      targetItemId: "item-1",
      tokensBefore: 20,
      tokensAfter: 10,
      replacementNote: "continued",
    }
    expect(PrepareResultSchema.safeParse({ ...base, transformations: [transformation] }).success).toBe(true)
    for (const bad of [{ tokensBefore: -1 }, { tokensAfter: 1.5 }]) {
      expect(PrepareResultSchema.safeParse({ ...base, transformations: [{ ...transformation, ...bad }] }).success).toBe(false)
    }
  })

  test("validates estimate and nullable actual usage/delta without allowing raw prompt or tool content", () => {
    const valid = {
      ...telemetry,
      requestDigest: `sha256:${"a".repeat(64)}`,
      estimatedOutputTokens: 4096,
      actualUsage: null,
      usageDelta: null,
    }
    expect(PrepareResultSchema.safeParse({ status: "ready", preparedItems: [item()], telemetry: valid }).success).toBe(true)
    expect(PrepareResultSchema.safeParse({ status: "ready", preparedItems: [item()], telemetry: {
      ...valid,
      actualUsage: { promptTokens: 90, completionTokens: 10, totalTokens: 100 },
      usageDelta: -10,
    } }).success).toBe(true)
    for (const invalid of [
      { ...valid, estimatedInputTokens: 1.5 },
      { ...valid, estimatedSafetyTokens: -1 },
      { ...valid, actualUsage: { promptTokens: -1, completionTokens: 0, totalTokens: 0 } },
      { ...valid, usageDelta: 1.5 },
      { ...valid, prompt: "raw prompt text" },
      { ...valid, toolContent: "raw tool result" },
    ]) {
      expect(PrepareResultSchema.safeParse({ status: "ready", preparedItems: [item()], telemetry: invalid }).success).toBe(false)
    }
  })
})

describe("ContextItemSchema", () => {
  test("accepts an item with tool metadata", () => {
    const result = ContextItemSchema.safeParse(
      item({
        type: "tool_result",
        toolMeta: { callId: "c1", toolName: "read_file", filePath: "src/Vault.sol", lineRange: [1, 400], isError: false },
      }),
    )
    expect(result.success).toBe(true)
  })

  test("accepts every documented item type and rejects others", () => {
    expect(ContextItemTypes).toHaveLength(11)
    ContextItemTypes.forEach((type) => expect(ContextItemSchema.safeParse(item({ type })).success).toBe(true))
    expect(ContextItemSchema.safeParse({ ...item(), type: "ground_truth" }).success).toBe(false)
  })

  test("rejects missing required fields", () => {
    const { isPinned: _isPinned, ...withoutPinned } = item()
    expect(ContextItemSchema.safeParse(withoutPinned).success).toBe(false)
    const { id: _id, ...withoutId } = item()
    expect(ContextItemSchema.safeParse(withoutId).success).toBe(false)
  })

  test("rejects a malformed lineRange or toolMeta", () => {
    expect(
      ContextItemSchema.safeParse(item({ toolMeta: { callId: "c", toolName: "t", lineRange: [1] as unknown as [number, number] } }))
        .success,
    ).toBe(false)
    expect(ContextItemSchema.safeParse({ ...item(), toolMeta: { toolName: "t" } }).success).toBe(false)
  })

  test("rejects a non-integer or negative turn", () => {
    expect(ContextItemSchema.safeParse(item({ turn: 1.5 })).success).toBe(false)
    expect(ContextItemSchema.safeParse(item({ turn: -1 })).success).toBe(false)
  })
})

describe("selectPinnedItems", () => {
  test("returns only pinned items", () => {
    const finding = item({ id: "f", type: "candidate_finding", isPinned: true })
    const reasoning = item({ id: "r", type: "assistant_reasoning", isPinned: false })
    expect(selectPinnedItems([finding, reasoning])).toEqual([finding])
  })

  test("preserves order and returns an empty list when nothing is pinned", () => {
    const a = item({ id: "a", isPinned: true })
    const b = item({ id: "b", isPinned: true })
    expect(selectPinnedItems([a, item({ id: "x" }), b]).map((entry) => entry.id)).toEqual(["a", "b"])
    expect(selectPinnedItems([item()])).toEqual([])
  })
})
