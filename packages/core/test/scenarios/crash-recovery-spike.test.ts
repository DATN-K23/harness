import { expect, test } from "bun:test"
import { createWorld, expectContiguous, readVault, runInput, verdictText } from "../helpers/runner-world"

// Task 7.1: worker A stops after step 2, worker B takes over after the lease expires and completes at step 3.
test("recovery spike: B continues at step 3 with A's items and A is rejected as stale", async () => {
  const script = [readVault("call-1", 1, 5), readVault("call-2", 10, 20), verdictText]

  const reference = createWorld()
  await reference.worker({ script }).start()

  const world = createWorld({ leaseMs: 1_000 })
  const a = world.worker({ script })
  world.store.failWhen((event) => event.type === "context.allocated" && event.payload.stepIndex === 3, { sticky: true })
  const claimA = await world.claim("worker-a")
  expect((await a.runner.run(claimA, runInput())).kind).toBe("error")
  expect(await world.state()).toBe("running")

  world.store.heal()
  world.clock.advance(2_000)
  const b = world.worker({ script: [verdictText] })
  const claimB = await world.claim("worker-b")

  // A comes back after B holds the lease: its write is refused and nothing changes.
  const before = await world.events()
  expect(await a.runner.run(claimA, runInput())).toMatchObject({ kind: "stale", reason: "claim_lost" })
  expect(await world.events()).toEqual(before)

  const result = await b.runner.run(claimB, runInput())
  expect(result).toMatchObject({ kind: "committed", state: "completed", lastStepIndex: 3 })
  expect(b.gateway.calls.map((call) => call.stepIndex)).toEqual([3])
  expect(b.gateway.calls[0].items).toEqual(a.engine.prepareCalls.at(-1)?.items ?? [])
  expect(b.ingestion.calls).toHaveLength(0)
  await expectContiguous(world)
  expect((await world.events()).map((event) => event.type)).toEqual(
    (await reference.events()).map((event) => event.type),
  )
  expect(await world.state()).toBe("completed")
})
