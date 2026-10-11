import { describe, expect, test } from "bun:test"
import { toolCallResponse } from "../../src/testing/scripted-model-gateway"
import { createWorld, expectContiguous, readVault, runInput, verdictText } from "../helpers/runner-world"
import { flags } from "../runner/judge-step-harness"

// Task 7.5. The scenario mixes parallel tool calls (one failing) with a second step, so ordering matters.
const script = () => [
  toolCallResponse([
    { id: "call-1", name: "read_file", arguments: { path: "src/Vault.sol", startLine: 1, endLine: 5 } },
    { id: "call-2", name: "read_file", arguments: { path: "src/Gone.sol" } },
    { id: "call-3", name: "grep", arguments: { pattern: "line 1" } },
  ]),
  readVault("call-4", 10, 20),
  verdictText,
]

const run = async (enableParallelToolDispatch = true) => {
  const world = createWorld()
  const w = world.worker({ script: script() })
  await w.start("worker-a", runInput({ flags: { ...flags, enableParallelToolDispatch } }))
  await expectContiguous(world)
  return (await world.events()).map((event) => ({
    type: event.type,
    sequence: event.sequence,
    payloadDigest: event.payloadDigest,
  }))
}

describe("determinism", () => {
  test("the same scenario, seed and flags produce identical event types, sequences and payload digests", async () => {
    const first = await run()
    expect(first.length).toBeGreaterThan(10)
    expect(await run()).toEqual(first)
  })

  test("parallel and sequential dispatch produce the same run apart from the recorded flag", async () => {
    const withoutStarted = (events: Awaited<ReturnType<typeof run>>) => events.filter((e) => e.type !== "run.started")
    expect(withoutStarted(await run(false))).toEqual(withoutStarted(await run(true)))
  })
})
