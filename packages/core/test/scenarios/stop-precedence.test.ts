import { expect, test } from "bun:test"
import { limits } from "../runner/judge-step-harness"
import { createWorld, readVault, runInput } from "../helpers/runner-world"

// Task 7.2: the pair and triple matrices over the six limits are in test/runner/stop-conditions.test.ts.
// This is the run-level telemetry for one pair.
test("two limits exhausted at one boundary: the earlier one ends the run and both are recorded", async () => {
  const world = createWorld()
  const w = world.worker({ script: [readVault("call-1", 1, 5)] })
  // One step uses 120 tokens and reaches the total-token limit.
  const tight = { ...limits, totalTokenBudget: 120 }
  const result = await w.start("worker-a", runInput({ limits: tight }))

  expect(result).toMatchObject({ kind: "committed", state: "budget_exhausted", terminalReason: "total_tokens" })
  const [exhausted] = await world.events("run.budget_exhausted")
  expect(exhausted.payload).toEqual({ reason: "total_tokens", observedLimits: ["total_tokens"] })
})
