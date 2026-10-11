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
