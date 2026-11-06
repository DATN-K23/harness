import { describe, expect, test } from "bun:test"
import * as protocol from "../src/index"

describe("@harness/protocol public surface", () => {
  test("re-exports the runtime values of every contract file", () => {
    const names = [
      "ContextItemSchema",
      "PrepareResultSchema",
      "selectPinnedItems",
      "JudgeVerdictSchema",
      "validateVerdict",
      "ProviderErrorCategories",
      "StopReasons",
      "StopPrecedence",
      "StopReasonToTerminalReason",
      "TerminalReasons",
      "BudgetLimitsSchema",
      "EventTypes",
      "RunStates",
      "TrajectoryEventSchema",
      "EventPayloadSchemas",
      "canonicalize",
      "RunConfigSnapshotSchema",
      "DefaultRetryConfig",
    ]
    expect(names.filter((name) => !(name in protocol))).toEqual([])
  })

  test("exposes only values that are pure data, schemas or functions", () => {
    const entries = Object.entries(protocol)
    expect(entries.length).toBeGreaterThan(30)
    expect(entries.every(([, value]) => value !== undefined)).toBe(true)
  })
})
