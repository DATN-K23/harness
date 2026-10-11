import { describe, expect, test } from "bun:test"
import type { RunState, TrajectoryEvent } from "@harness/protocol"
import { FakeClock } from "../../src/testing/deterministic"
import { InMemoryRunStore } from "../../src/testing/in-memory-run-store"
import { newTestEvent, runStoreContractTests } from "../../src/testing/run-store-contract"

const leaseMs = 10_000

const makeHarness = () => {
  const clock = new FakeClock(1_000)
  const store = new InMemoryRunStore({ clock, leaseMs })
  return {
    store,
    clock,
    seedRun: async (runId: string, state: RunState = "queued") => store.seedRun(runId, state),
    expireLeases: async () => clock.advance(leaseMs + 1),
  }
}

runStoreContractTests(makeHarness)

const startedRun = async () => {
  const harness = makeHarness()
  harness.store.seedRun("run-1", "queued")
  const claimed = await harness.store.claim({ runId: "run-1", workerId: "worker-a" })
  if (claimed.kind !== "claimed") throw new Error("expected a claim")
  const started = await harness.store.transition({
    claim: claimed.claim,
    expectedState: "queued",
    expectedStateVersion: claimed.stateVersion,
    nextState: "running",
  })
  if (started.kind !== "transitioned") throw new Error("expected a transition")
  return { ...harness, claim: claimed.claim, stateVersion: started.stateVersion }
}

describe("InMemoryRunStore lease expiry", () => {
  test("a claim is valid exactly until the injected clock passes the lease", async () => {
    const harness = makeHarness()
    harness.store.seedRun("run-1")
    await harness.store.claim({ runId: "run-1", workerId: "worker-a" })
    harness.clock.advance(leaseMs - 1)
    expect(await harness.store.claim({ runId: "run-1", workerId: "worker-b" })).toEqual({
      kind: "unavailable",
      reason: "already_claimed",
    })
    harness.clock.advance(1)
    expect((await harness.store.claim({ runId: "run-1", workerId: "worker-b" })).kind).toBe("claimed")
  })

  test("seeding the same run twice is a test-setup error", () => {
    const { store } = makeHarness()
    store.seedRun("run-1")
    expect(() => store.seedRun("run-1")).toThrow("already exists")
  })
})

describe("InMemoryRunStore uniqueness guard", () => {
  test("a duplicated sequence is rejected and nothing is appended", async () => {
    const { store, claim, stateVersion } = await startedRun()
    await store.appendEvent({ claim, expectedStateVersion: stateVersion, event: newTestEvent("one") })
    store.duplicateNextSequence()
    await expect(
      store.appendEvent({ claim, expectedStateVersion: stateVersion, event: newTestEvent("dup") }),
    ).rejects.toThrow("sequence 1")
    expect((await store.loadEvents({ runId: "run-1" })).map((event) => event.sequence)).toEqual([1])
  })

  test("a skipped sequence is rejected as non-contiguous, and the next honest append still gets the next number", async () => {
    const { store, claim, stateVersion } = await startedRun()
    store.forceNextSequence(3)
    await expect(
      store.appendEvent({ claim, expectedStateVersion: stateVersion, event: newTestEvent("gap") }),
    ).rejects.toThrow("sequence 3")
    const next = await store.appendEvent({ claim, expectedStateVersion: stateVersion, event: newTestEvent("ok") })
    expect(next.kind === "appended" && next.event.sequence).toBe(1)
  })
})

describe("InMemoryRunStore fault injection", () => {
  test("failNext rejects exactly the next call of that operation and changes nothing", async () => {
    const { store, claim, stateVersion } = await startedRun()
    store.failNext("transition")
    await expect(
      store.transition({
        claim,
        expectedState: "running",
        expectedStateVersion: stateVersion,
        nextState: "completed",
      }),
    ).rejects.toThrow("injected transition failure")
    expect(await store.loadRun("run-1")).toMatchObject({ state: "running", stateVersion })
    const retried = await store.transition({
      claim,
      expectedState: "running",
      expectedStateVersion: stateVersion,
      nextState: "completed",
    })
    expect(retried.kind).toBe("transitioned")
  })

  test("failNext targets one operation and accepts a custom error", async () => {
    const { store, claim, stateVersion } = await startedRun()
    const boom = new Error("disk full")
    store.failNext("appendEvent", boom)
    expect(await store.loadRun("run-1")).toBeDefined()
    await expect(
      store.appendEvent({ claim, expectedStateVersion: stateVersion, event: newTestEvent("x") }),
    ).rejects.toBe(boom)
  })

  test("queued faults fire in order", async () => {
    const { store } = await startedRun()
    store.failNext("loadEvents")
    store.failNext("loadEvents", new Error("second"))
    await expect(store.loadEvents({ runId: "run-1" })).rejects.toThrow("injected loadEvents failure")
    await expect(store.loadEvents({ runId: "run-1" })).rejects.toThrow("second")
    expect(await store.loadEvents({ runId: "run-1" })).toEqual([])
  })

  test("an aborted signal rejects before touching state", async () => {
    const { store } = await startedRun()
    await expect(store.loadRun("run-1", AbortSignal.abort())).rejects.toBeDefined()
  })
})

describe("InMemoryRunStore live append hook", () => {
  test("listeners receive each stored event in sequence order", async () => {
    const { store, claim, stateVersion } = await startedRun()
    const seen: TrajectoryEvent[] = []
    store.onAppend((event) => seen.push(event))
    for (const label of ["a", "b"])
      await store.appendEvent({ claim, expectedStateVersion: stateVersion, event: newTestEvent(label) })
    expect(seen.map((event) => event.sequence)).toEqual([1, 2])
    expect(seen).toEqual(await store.loadEvents({ runId: "run-1" }))
  })

  test("rejected appends are not published and unsubscribe stops delivery", async () => {
    const { store, claim, stateVersion } = await startedRun()
    const seen: number[] = []
    const unsubscribe = store.onAppend((event) => seen.push(event.sequence))
    await store.appendEvent({ claim, expectedStateVersion: stateVersion - 1, event: newTestEvent("stale") })
    expect(seen).toEqual([])
    await store.appendEvent({ claim, expectedStateVersion: stateVersion, event: newTestEvent("fresh") })
    unsubscribe()
    await store.appendEvent({ claim, expectedStateVersion: stateVersion, event: newTestEvent("after") })
    expect(seen).toEqual([1])
  })
})

describe("InMemoryRunStore stored events", () => {
  test("store the caller's fields verbatim and hand out copies", async () => {
    const { store, claim, stateVersion } = await startedRun()
    const event = newTestEvent("copy")
    const appended = await store.appendEvent({ claim, expectedStateVersion: stateVersion, event })
    if (appended.kind !== "appended") throw new Error("expected an append")
    expect(appended.event).toEqual({ ...event, runId: "run-1", sequence: 1 })
    appended.event.payload.label = "mutated"
    const [loaded] = await store.loadEvents({ runId: "run-1" })
    expect(loaded.payload).toEqual({ label: "copy" })
  })
})
