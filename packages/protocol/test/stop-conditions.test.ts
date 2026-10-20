import { describe, expect, test } from "bun:test"
import {
  BudgetLimitsSchema,
  BudgetTerminalReasons,
  StopPrecedence,
  StopReasons,
  StopReasonToTerminalReason,
  TerminalReasonNamespaces,
  TerminalReasons,
  TerminalReasonSchema,
} from "../src/stop-conditions"

describe("stop reason precedence", () => {
  test("lists the six non-cost stop reasons in the documented order", () => {
    expect([...StopPrecedence]).toEqual([
      "wall_clock_timeout",
      "total_tokens_exhausted",
      "max_steps_exceeded",
      "max_tool_calls_exceeded",
      "context_budget_exhausted",
      "no_progress_detected",
    ])
    expect(StopPrecedence).toEqual(StopReasons)
  })
})

describe("stop reason to terminal reason mapping", () => {
  test("is total: every stop reason maps to a blueprint budget terminal reason", () => {
    const mapped = StopReasons.map((reason) => StopReasonToTerminalReason[reason])
    expect(mapped.every((reason) => BudgetTerminalReasons.includes(reason))).toBe(true)
    expect(Object.keys(StopReasonToTerminalReason).sort()).toEqual([...StopReasons].sort())
  })

  test("is unique: no two stop reasons share a terminal reason and every terminal reason is used", () => {
    const mapped = StopReasons.map((reason) => StopReasonToTerminalReason[reason])
    expect(new Set(mapped).size).toBe(StopReasons.length)
    expect([...mapped].sort()).toEqual(BudgetTerminalReasons.filter((reason) => reason !== "cost_budget").sort())
  })

  test("maps names exactly as the design document states", () => {
    expect(StopReasonToTerminalReason).toEqual({
      wall_clock_timeout: "wall_clock",
      total_tokens_exhausted: "total_tokens",
      max_steps_exceeded: "max_steps",
      max_tool_calls_exceeded: "max_tool_calls",
      context_budget_exhausted: "context_budget",
      no_progress_detected: "no_progress",
    })
  })
})

describe("terminal reason vocabulary", () => {
  test("contains every blueprint value exactly once", () => {
    expect<number>(TerminalReasons.length).toBe(Object.values(TerminalReasonNamespaces).flat().length)
    expect(new Set(TerminalReasons).size).toBe(TerminalReasons.length)
    expect(TerminalReasons.length).toBe(24)
  })

  test("schema accepts blueprint reasons and rejects stop-reason spellings", () => {
    expect(TerminalReasonSchema.safeParse("schema_repair_exhausted").success).toBe(true)
    expect(TerminalReasonSchema.safeParse("max_steps_exceeded").success).toBe(false)
    expect(TerminalReasonSchema.safeParse("max_tool_calls").success).toBe(true)
  })
})

describe("BudgetLimitsSchema", () => {
  const limits = {
    wallClockTimeoutMs: 600000,
      totalTokenBudget: 500000,
    maxSteps: 20,
    noProgressMaxRepeats: 3,
  }

  test("accepts the non-cost limits without maxToolCalls", () => {
    expect(BudgetLimitsSchema.safeParse(limits).success).toBe(true)
  })

  test("accepts optional positive maxToolCalls", () => {
    expect(BudgetLimitsSchema.safeParse({ ...limits, maxToolCalls: 15 }).success).toBe(true)
    expect(BudgetLimitsSchema.safeParse({ ...limits, maxToolCalls: 0 }).success).toBe(false)
    expect(BudgetLimitsSchema.safeParse({ ...limits, maxToolCalls: -1 }).success).toBe(false)
  })

  test("rejects non-positive step counts and missing limits", () => {
    expect(BudgetLimitsSchema.safeParse({ ...limits, maxSteps: 0 }).success).toBe(false)
    const { noProgressMaxRepeats: _omitted, ...rest } = limits
    expect(BudgetLimitsSchema.safeParse(rest).success).toBe(false)
  })

  test("preserves a legacy cost ceiling in historical snapshots without making it required", () => {
    const parsed = BudgetLimitsSchema.safeParse({
      wallClockTimeoutMs: 600000,
      totalTokenBudget: 500000,
      maxSteps: 20,
      noProgressMaxRepeats: 3,
      costCeilingUsd: 5,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.costCeilingUsd).toBe(5)
    expect(BudgetLimitsSchema.safeParse(limits).success).toBe(true)
  })
})
