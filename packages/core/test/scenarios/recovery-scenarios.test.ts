import { describe, expect, test } from "bun:test"
import { InterruptedToolMessage } from "../../src/runner/history-hydrator"
import { errorResponse, toolCallResponse, type ScriptedModelEntry } from "../../src/testing/scripted-model-gateway"
import { createWorld, expectContiguous, readVault, runInput, verdictText } from "../helpers/runner-world"

// Task 7.3: every failure kind is data for the model; the run continues to a verdict and never ends on the failure.
const toolCall = (name: string, args: Record<string, unknown>) =>
  toolCallResponse([{ id: "call-1", name, arguments: args }])

const completesAfter = async (first: ScriptedModelEntry) => {
  const world = createWorld()
  const w = world.worker({ script: [first, verdictText] })
  const result = await w.start()
  expect(result).toMatchObject({ kind: "committed", state: "completed" })
  expect(await world.events("run.failed")).toHaveLength(0)
  await expectContiguous(world)
  const toolResult = w.gateway.calls[1].items.find((item) => item.type === "tool_result")
  return { world, w, toolResult }
}

describe("recovery scenarios", () => {
  test("tool not found: an error result names the problem and the run reaches a verdict", async () => {
    const { world, toolResult } = await completesAfter(toolCall("no_such_tool", {}))
    expect(toolResult?.toolMeta?.isError).toBe(true)
    expect(await world.events("tool.failed")).toHaveLength(1)
  })

  test("malformed arguments: an error result and the run reaches a verdict", async () => {
    const { world, w, toolResult } = await completesAfter(toolCall("read_file", { startLine: "one" }))
    expect(toolResult?.toolMeta?.isError).toBe(true)
    expect(w.registry.calls).toHaveLength(0)
    expect(await world.events("tool.failed")).toHaveLength(1)
  })

  test("denied path: security.blocked is recorded and the run reaches a verdict", async () => {
    const { world, toolResult } = await completesAfter(toolCall("read_file", { path: "secrets/key.txt" }))
    expect(toolResult?.content).not.toContain("hunter2")
    expect(await world.events("security.blocked")).toHaveLength(1)
  })

  test("transient provider errors: two failures are retried and the run reaches a verdict", async () => {
    const transient = (statusCode: number) =>
      errorResponse({ isRetryable: true, category: "transport", message: `HTTP ${statusCode}`, statusCode })
    const world = createWorld()
    const w = world.worker({ script: [transient(503), transient(429), verdictText] })
    expect(await w.start()).toMatchObject({ kind: "committed", state: "completed" })
    expect(await world.events("provider.attempted")).toHaveLength(3)
  })

  test("interrupted tool from a dead worker: B reports it as interrupted, does not re-run it, completes", async () => {
    const world = createWorld({ leaseMs: 1_000 })
    const a = world.worker({ script: [readVault("call-1", 1, 5)] })
    world.store.failWhen((event) => event.type === "tool.completed", { sticky: true })
    expect((await a.start("worker-a")).kind).toBe("error")
    world.store.heal()
    world.clock.advance(2_000)

    const b = world.worker({ script: [verdictText] })
    const result = await b.start("worker-b")
    expect(result).toMatchObject({ kind: "committed", state: "completed" })
    expect(b.registry.calls).toHaveLength(0)
    const interrupted = b.gateway.calls[0].items.find((item) => item.type === "tool_result")
    expect(interrupted?.toolMeta).toMatchObject({ callId: "call-1", isError: true })
    expect(interrupted?.content).toStartWith(InterruptedToolMessage)
    expect(await world.events("run.failed")).toHaveLength(0)
    await expectContiguous(world)
  })
})
