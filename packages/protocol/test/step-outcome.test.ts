import { describe, expect, test } from "bun:test"
import type { StepOutcome } from "../src/step-outcome"

const assertNever = (value: never): never => {
  throw new Error(`unhandled outcome ${JSON.stringify(value)}`)
}

const describeExhaustively = (outcome: StepOutcome) => {
  switch (outcome.type) {
    case "completed":
      return `completed ${outcome.verdict.validity}`
    case "needs_compaction":
      return `compact ${outcome.itemsToSummarize.length}`
    case "continue_turn":
      return `continue ${outcome.toolOutcomes.length}`
    case "budget_exhausted":
      return `budget ${outcome.reason}`
    case "failed":
      return `failed ${outcome.error}`
    default:
      return assertNever(outcome)
  }
}

const describeNonExhaustively = (outcome: StepOutcome) => {
  switch (outcome.type) {
    case "completed":
    case "needs_compaction":
    case "continue_turn":
    case "budget_exhausted":
      return outcome.type
    default:
      // @ts-expect-error the failed variant is not handled, so outcome is not never
      return assertNever(outcome)
  }
}

describe("StepOutcome", () => {
  test("an exhaustive switch handles every variant", () => {
    expect(describeExhaustively({ type: "budget_exhausted", reason: "max_steps_exceeded" })).toBe(
      "budget max_steps_exceeded",
    )
    expect(describeExhaustively({ type: "failed", error: "boom" })).toBe("failed boom")
    expect(describeExhaustively({ type: "continue_turn", toolOutcomes: [] })).toBe("continue 0")
    const compaction: StepOutcome = { type: "needs_compaction", summaryPrompt: "s", itemsToSummarize: [] }
    expect(describeExhaustively(compaction)).toBe("compact 0")
  })

  test("a switch that omits a variant fails at compile time and at runtime", () => {
    expect(describeNonExhaustively({ type: "continue_turn", toolOutcomes: [] })).toBe("continue_turn")
    expect(() => describeNonExhaustively({ type: "failed", error: "boom" })).toThrow("unhandled outcome")
  })

  test("variants carry the documented payloads", () => {
    const outcomes: StepOutcome[] = [
      { type: "continue_turn", toolOutcomes: [] },
      { type: "budget_exhausted", reason: "no_progress_detected" },
      { type: "failed", error: "x", reason: "schema_repair_exhausted" },
    ]
    expect(outcomes.map((outcome) => outcome.type)).toEqual(["continue_turn", "budget_exhausted", "failed"])
  })
})
