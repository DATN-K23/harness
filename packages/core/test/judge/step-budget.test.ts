import { describe, expect, test } from "bun:test"
import type { ContextItem } from "@harness/protocol"
import { isEvidenceSaturated, mustAnswerNow } from "../../src/judge/step-budget"

let id = 0
const read = (turn: number, filePath: string, lineRange: [number, number]): ContextItem => ({
  id: `r${id++}`, turn, type: "tool_result", isPinned: false, content: `${filePath} ${lineRange}`,
  toolMeta: { callId: `c${id}`, toolName: "read_file", filePath, lineRange },
})
const grep = (turn: number, content: string, isError = false): ContextItem => ({
  id: `g${id++}`, turn, type: "tool_result", isPinned: false, content, toolMeta: { callId: `c${id}`, toolName: "grep", isError },
})

describe("evidence saturation", () => {
  test("reading new lines or new search results is not saturated", () => {
    const items = [read(1, "A.sol", [1, 40]), read(2, "A.sol", [41, 80]), grep(3, "A.sol:12: x"), read(4, "B.sol", [1, 10])]
    expect(isEvidenceSaturated(items, 0, 3)).toBe(false)
  })

  test("three results in a row that add nothing saturate the direction (overlapping re-reads, repeated search, errors)", () => {
    const items = [read(1, "A.sol", [210, 240]), grep(2, "A.sol:220: guard"), read(3, "A.sol", [220, 235]), grep(4, "A.sol:220: guard"), grep(5, "no such file", true)]
    expect(isEvidenceSaturated(items, 0, 3)).toBe(true)
    expect(isEvidenceSaturated(items.slice(0, 4), 0, 3)).toBe(false)
  })

  test("only results of the current direction count, but earlier ones are already seen", () => {
    const forward = [read(1, "A.sol", [1, 100]), read(2, "B.sol", [1, 100])]
    // The backward direction starts after step 2 and re-reads what forward read: two non-new results so far.
    const backward = [read(3, "A.sol", [10, 20]), read(4, "B.sol", [5, 9])]
    expect(isEvidenceSaturated([...forward, ...backward], 2, 3)).toBe(false)
    expect(isEvidenceSaturated([...forward, ...backward, read(5, "A.sol", [50, 60])], 2, 3)).toBe(true)
  })
})

describe("token safety net", () => {
  test("a direction answers once the tokens left cover only this step and the ones still needed", () => {
    const base = { pending: "forward" as const, estimatedInputTokens: 6_000, maxOutputTokens: 4_000, safetyMarginFactor: 1.2, totalTokenBudget: 5_000_000 }
    // 12k per step, 4 steps (this, backward, verdict, repair) = 48k.
    expect(mustAnswerNow({ ...base, totalTokensUsed: 4_900_000 })).toBe(false)
    expect(mustAnswerNow({ ...base, totalTokensUsed: 4_960_000 })).toBe(true)
  })
})
