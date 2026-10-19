import { describe, expect, test } from "bun:test"
import { StopPrecedence, type BudgetLimits, type StopReason } from "@harness/protocol"
import {
  evaluateStop,
  initialNoProgress,
  isForcedStep,
  observeToolCalls,
  type StopState,
} from "../../src/runner/stop-conditions"

const limits: BudgetLimits = {
  wallClockTimeoutMs: 60_000,
  costCeilingUsd: 1,
  totalTokenBudget: 100_000,
  maxSteps: 10,
  noProgressMaxRepeats: 3,
}

const startedAtMs = 1_000
const within: StopState = {
  startedAtMs,
  costUsd: 0.5,
  totalTokens: 50_000,
  completedSteps: 5,
  completedToolCalls: 2,
  contextBudgetExhausted: false,
  noProgress: initialNoProgress,
}
const nowWithin = startedAtMs + 10_000

const exhaust = (reason: StopReason): Partial<StopState> => {
  if (reason === "cost_budget_exhausted") return { costUsd: 1 }
  if (reason === "total_tokens_exhausted") return { totalTokens: 100_000 }
  if (reason === "max_steps_exceeded") return { completedSteps: 10 }
  if (reason === "max_tool_calls_exceeded") return { completedToolCalls: 10 }
  if (reason === "context_budget_exhausted") return { contextBudgetExhausted: true }
  if (reason === "no_progress_detected") return { noProgress: { lastKey: "x", repeats: 3 } }
  return {}
}

const evaluateWith = (reasons: readonly StopReason[]) => {
  const limitsWithToolCalls: BudgetLimits = { ...limits, maxToolCalls: 10 }
  const state = reasons.reduce<StopState>((acc, reason) => ({ ...acc, ...exhaust(reason) }), within)
  const now = reasons.includes("wall_clock_timeout") ? startedAtMs + limits.wallClockTimeoutMs : nowWithin
  return evaluateStop(state, limitsWithToolCalls, now)
}

const inPrecedence = (reasons: readonly StopReason[]) => StopPrecedence.filter((reason) => reasons.includes(reason))

const pairs = StopPrecedence.flatMap((first, index) =>
  StopPrecedence.slice(index + 1).map((second) => [first, second] as const),
)
const triples = StopPrecedence.flatMap((first, i) =>
  StopPrecedence.slice(i + 1).flatMap((second, j) =>
    StopPrecedence.slice(i + j + 2).map((third) => [first, second, third] as const),
  ),
)

describe("evaluateStop", () => {
  test("selects nothing while every limit has headroom", () => {
    expect(evaluateStop(within, limits, nowWithin)).toEqual({ selected: undefined, observed: [] })
  })

  test.each(StopPrecedence.map((reason) => [reason] as const))(
    "selects %s when it is the only exhausted limit",
    (reason) => {
      expect(evaluateWith([reason])).toEqual({ selected: reason, observed: [reason] })
    },
  )

  test("pair matrix covers all 21 pairs", () => {
    expect(pairs).toHaveLength(21)
  })

  test.each(pairs)("pair %s + %s selects the higher precedence and observes both", (first, second) => {
    expect(evaluateWith([second, first])).toEqual({ selected: first, observed: [first, second] })
  })

  test("triple matrix covers all 35 triples", () => {
    expect(triples).toHaveLength(35)
  })

  test.each(triples)("triple %s + %s + %s selects the highest precedence and observes all three", (a, b, c) => {
    expect(evaluateWith([c, b, a])).toEqual({ selected: a, observed: inPrecedence([a, b, c]) })
  })

  test("cost, total tokens and max steps together select cost and list all three", () => {
    const result = evaluateWith(["max_steps_exceeded", "total_tokens_exhausted", "cost_budget_exhausted"])
    expect(result.selected).toBe("cost_budget_exhausted")
    expect(result.observed).toEqual(["cost_budget_exhausted", "total_tokens_exhausted", "max_steps_exceeded"])
  })

  test("all seven exhausted selects wall clock and lists every reason in precedence order", () => {
    expect(evaluateWith(StopPrecedence)).toEqual({ selected: "wall_clock_timeout", observed: [...StopPrecedence] })
  })

  test("unpriced runs skip only the cost ceiling check", () => {
    const overCost = { ...within, costUsd: 2 }
    expect(evaluateStop(overCost, limits, nowWithin).selected).toBe("cost_budget_exhausted")
    expect(evaluateStop(overCost, limits, nowWithin, false)).toEqual({ selected: undefined, observed: [] })
    expect(evaluateStop({ ...overCost, totalTokens: 100_000 }, limits, nowWithin, false).selected).toBe(
      "total_tokens_exhausted",
    )
  })

  test("a limit is exhausted exactly when it is reached", () => {
    expect(evaluateStop({ ...within, completedSteps: 9 }, limits, nowWithin).selected).toBeUndefined()
    expect(evaluateStop({ ...within, completedSteps: 10 }, limits, nowWithin).selected).toBe("max_steps_exceeded")
    expect(evaluateStop(within, limits, startedAtMs + 59_999).selected).toBeUndefined()
    expect(evaluateStop(within, limits, startedAtMs + 60_000).selected).toBe("wall_clock_timeout")
    expect(evaluateStop({ ...within, costUsd: 0.999 }, limits, nowWithin).selected).toBeUndefined()
    expect(evaluateStop({ ...within, totalTokens: 99_999 }, limits, nowWithin).selected).toBeUndefined()
    expect(evaluateStop({ ...within, completedToolCalls: 9 }, { ...limits, maxToolCalls: 10 }, nowWithin).selected).toBeUndefined()
    expect(evaluateStop({ ...within, completedToolCalls: 10 }, { ...limits, maxToolCalls: 10 }, nowWithin).selected).toBe("max_tool_calls_exceeded")
    // When maxToolCalls is omitted/undefined, tool calls do not trigger stop
    expect(evaluateStop({ ...within, completedToolCalls: 100 }, limits, nowWithin).selected).toBeUndefined()
  })
})

describe("no-progress detector", () => {
  const read = (path: string) => ({ toolName: "read_file", arguments: { path, startLine: 1 } })

  test("counts consecutive identical calls and stops at noProgressMaxRepeats", () => {
    const one = observeToolCalls(initialNoProgress, [read("a.sol")], true)
    const two = observeToolCalls(one, [read("a.sol")], true)
    const three = observeToolCalls(two, [read("a.sol")], true)
    expect([one.repeats, two.repeats, three.repeats]).toEqual([1, 2, 3])
    expect(evaluateStop({ ...within, noProgress: two }, limits, nowWithin).selected).toBeUndefined()
    expect(evaluateStop({ ...within, noProgress: three }, limits, nowWithin)).toEqual({
      selected: "no_progress_detected",
      observed: ["no_progress_detected"],
    })
  })

  test("a different call resets the count to one", () => {
    const two = observeToolCalls(initialNoProgress, [read("a.sol"), read("a.sol")], true)
    expect(two.repeats).toBe(2)
    const reset = observeToolCalls(two, [read("b.sol")], true)
    expect(reset.repeats).toBe(1)
    expect(observeToolCalls(reset, [read("a.sol")], true).repeats).toBe(1)
  })

  test("a different tool name with identical arguments is a different call", () => {
    const first = observeToolCalls(initialNoProgress, [{ toolName: "read_file", arguments: { path: "a" } }], true)
    const second = observeToolCalls(first, [{ toolName: "list_files", arguments: { path: "a" } }], true)
    expect(second.repeats).toBe(1)
  })

  test("arguments that differ only in key order are identical, including nested objects", () => {
    const first = observeToolCalls(
      initialNoProgress,
      [{ toolName: "grep", arguments: { pattern: "x", options: { a: 1, b: 2 }, path: "p" } }],
      true,
    )
    const second = observeToolCalls(
      first,
      [{ toolName: "grep", arguments: { path: "p", options: { b: 2, a: 1 }, pattern: "x" } }],
      true,
    )
    expect(second.repeats).toBe(2)
  })

  test("calls inside one response are observed in order", () => {
    const state = observeToolCalls(initialNoProgress, [read("a"), read("a"), read("a")], true)
    expect(state.repeats).toBe(3)
  })

  test("enableNoProgressDetection off never counts and never stops", () => {
    const state = Array.from({ length: 10 }).reduce<typeof initialNoProgress>(
      (acc) => observeToolCalls(acc, [read("a.sol")], false),
      initialNoProgress,
    )
    expect(state).toEqual(initialNoProgress)
    expect(evaluateStop({ ...within, noProgress: state }, limits, nowWithin).selected).toBeUndefined()
  })

  test("enableNoProgressDetection on stops the same sequence", () => {
    const state = Array.from({ length: 3 }).reduce<typeof initialNoProgress>(
      (acc) => observeToolCalls(acc, [read("a.sol")], true),
      initialNoProgress,
    )
    expect(evaluateStop({ ...within, noProgress: state }, limits, nowWithin).selected).toBe("no_progress_detected")
  })

  test("switching detection off after a streak clears the streak", () => {
    const streak = observeToolCalls(initialNoProgress, [read("a"), read("a")], true)
    expect(observeToolCalls(streak, [read("a")], false)).toEqual(initialNoProgress)
  })
})

describe("isForcedStep", () => {
  test("is true from the penultimate step with 1-indexed steps when enabled", () => {
    const forced = [1, 2, 3, 4, 5].map((step) => isForcedStep(step, 4, true))
    expect(forced).toEqual([false, false, true, true, true])
  })

  test("is always false when enableMaxStepsForcing is off", () => {
    expect([1, 2, 3, 4].map((step) => isForcedStep(step, 4, false))).toEqual([false, false, false, false])
  })
})
