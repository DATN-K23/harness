import { describe, expect, test } from "bun:test"
import { AbsolutePathRedactedPlaceholder, type TrajectoryEvent } from "@harness/protocol"
import { EventBus } from "../../src/runner/event-bus"
import { EventSink, InvalidEventError, normalizeBlockedInput } from "../../src/runner/event-sink"
import { FakeClock, SeededRandom } from "../../src/testing/deterministic"
import { InMemoryRunStore } from "../../src/testing/in-memory-run-store"
import { digestOf } from "../../src/util/digest"
import { createIdGenerator } from "../../src/util/id"

const setup = async (options: { bus?: EventBus } = {}) => {
  const clock = new FakeClock(Date.parse("2026-03-01T00:00:00.000Z"))
  const random = new SeededRandom(7)
  const store = new InMemoryRunStore({ clock, leaseMs: 1_000 })
  store.seedRun("run-1", "queued")
  const claimed = await store.claim({ runId: "run-1", workerId: "worker-a" })
  if (claimed.kind !== "claimed") throw new Error("expected a claim")
  const sink = new EventSink({
    store,
    claim: claimed.claim,
    expectedStateVersion: claimed.stateVersion,
    ids: createIdGenerator({ clock: () => clock.nowMs(), random: (size) => random.bytes(size) }),
    clock,
    bus: options.bus,
  })
  return { clock, store, claim: claimed.claim, stateVersion: claimed.stateVersion, sink }
}

const stage = (name: "ingestion" | "sanitizer") => ({ stage: name }) as const

describe("EventSink append", () => {
  test("sequences are contiguous from 1 with no duplicates, even when appends are issued concurrently", async () => {
    const { sink, store } = await setup()
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        sink.append("step.started", { stepIndex: index + 1, toolsDisabled: false }),
      ),
    )
    expect(results.every((result) => result.kind === "appended")).toBe(true)
    const stored = await store.loadEvents({ runId: "run-1" })
    expect(stored.map((event) => event.sequence)).toEqual(Array.from({ length: 25 }, (_, index) => index + 1))
    expect(stored.map((event) => event.payload.stepIndex)).toEqual(Array.from({ length: 25 }, (_, index) => index + 1))
    expect(new Set(stored.map((event) => event.eventId)).size).toBe(25)
  })

  test("records the payload digest, schema version, id prefix and injected clock time", async () => {
    const { sink, clock } = await setup()
    clock.advance(2_500)
    const result = await sink.append("stage.started", stage("ingestion"))
    if (result.kind !== "appended") throw new Error("expected an append")
    expect(result.event).toMatchObject({
      runId: "run-1",
      sequence: 1,
      type: "stage.started",
      schemaVersion: 1,
      payload: { stage: "ingestion" },
      payloadDigest: digestOf({ stage: "ingestion" }),
      occurredAt: "2026-03-01T00:00:02.500Z",
    })
    expect(result.event.eventId.startsWith("evt_")).toBe(true)
  })

  test("equal payloads have equal digests regardless of key order; different payloads differ", async () => {
    const { sink } = await setup()
    const first = await sink.append("run.accepted", { alpha: 1, beta: { x: 1, y: 2 } })
    const second = await sink.append("run.accepted", { beta: { y: 2, x: 1 }, alpha: 1 })
    const third = await sink.append("run.accepted", { alpha: 2, beta: { x: 1, y: 2 } })
    if (first.kind !== "appended" || second.kind !== "appended" || third.kind !== "appended")
      throw new Error("expected appends")
    expect(first.event.payloadDigest).toBe(second.event.payloadDigest)
    expect(first.event.payloadDigest).not.toBe(third.event.payloadDigest)
  })

  test("a payload that breaks the protocol contract is rejected before anything is stored", async () => {
    const { sink, store } = await setup()
    // @ts-expect-error the stage name is deliberately wrong
    const append = sink.append("stage.started", { stage: "not-a-stage" })
    await expect(append).rejects.toBeInstanceOf(InvalidEventError)
    expect(await store.loadEvents({ runId: "run-1" })).toEqual([])
    const next = await sink.append("stage.started", stage("sanitizer"))
    expect(next.kind === "appended" && next.event.sequence).toBe(1)
  })

  test("a payload carrying a forbidden key is rejected", async () => {
    const { sink } = await setup()
    await expect(sink.append("run.accepted", { score: 3 })).rejects.toBeInstanceOf(InvalidEventError)
  })
})

describe("EventSink stale results", () => {
  test("a lost claim is a typed stale result, not a throw, and nothing is stored or published", async () => {
    const bus = new EventBus()
    const seen: TrajectoryEvent[] = []
    bus.subscribe((event) => seen.push(event))
    const { sink, store, clock } = await setup({ bus })
    clock.advance(1_001)
    const takeover = await store.claim({ runId: "run-1", workerId: "worker-b" })
    expect(takeover.kind).toBe("claimed")

    const result = await sink.append("stage.started", stage("ingestion"))
    expect(result).toEqual({ kind: "stale", reason: "claim_lost" })
    expect(await store.loadEvents({ runId: "run-1" })).toEqual([])
    expect(seen).toEqual([])
  })

  test("a changed state version is stale until the sink is told the new version", async () => {
    const { sink, store, claim, stateVersion } = await setup()
    const moved = await store.transition({
      claim,
      expectedState: "queued",
      expectedStateVersion: stateVersion,
      nextState: "running",
    })
    if (moved.kind !== "transitioned") throw new Error("expected a transition")

    expect(await sink.append("stage.started", stage("ingestion"))).toEqual({ kind: "stale", reason: "state_changed" })
    sink.setExpectedStateVersion(moved.stateVersion)
    expect((await sink.append("stage.started", stage("ingestion"))).kind).toBe("appended")
  })

  test("appends to a terminal run are stale", async () => {
    const { sink, store, claim, stateVersion } = await setup()
    const moved = await store.transition({
      claim,
      expectedState: "queued",
      expectedStateVersion: stateVersion,
      nextState: "cancelled",
      terminalReason: "cancelled_by_user",
    })
    if (moved.kind !== "transitioned") throw new Error("expected a transition")
    sink.setExpectedStateVersion(moved.stateVersion)
    expect(await sink.append("run.cancel_requested", {})).toEqual({ kind: "stale", reason: "state_changed" })
  })

  test("a store fault propagates and does not wedge later appends", async () => {
    const { sink, store } = await setup()
    store.failNext("appendEvent", new Error("disk full"))
    await expect(sink.append("stage.started", stage("ingestion"))).rejects.toThrow("disk full")
    const next = await sink.append("stage.started", stage("ingestion"))
    expect(next.kind === "appended" && next.event.sequence).toBe(1)
  })
})

describe("EventSink publishes to the bus", () => {
  test("subscribers receive each persisted event in sequence order, including for concurrent appends", async () => {
    const bus = new EventBus()
    const seen: number[] = []
    bus.subscribe((event) => seen.push(event.sequence))
    const { sink } = await setup({ bus })
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        sink.append("step.started", { stepIndex: index + 1, toolsDisabled: false }),
      ),
    )
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  test("the published event is the stored event", async () => {
    const bus = new EventBus()
    const seen: TrajectoryEvent[] = []
    bus.subscribe((event) => seen.push(event))
    const { sink, store } = await setup({ bus })
    await sink.append("stage.started", stage("ingestion"))
    expect(seen).toEqual(await store.loadEvents({ runId: "run-1" }))
  })
})

describe("security.blocked input", () => {
  test.each([
    ["/etc/passwd", AbsolutePathRedactedPlaceholder],
    ["  /etc/passwd  ", AbsolutePathRedactedPlaceholder],
    ["\t\\\\server\\share\\key", AbsolutePathRedactedPlaceholder],
    ["C:\\Users\\victim\\.ssh\\id_rsa", AbsolutePathRedactedPlaceholder],
    [" c:/Windows/system32", AbsolutePathRedactedPlaceholder],
    ["FILE:///etc/shadow", AbsolutePathRedactedPlaceholder],
    ["  ../secrets/key.txt  ", "../secrets/key.txt"],
    ["secrets\\key.txt", "secrets/key.txt"],
    ["src/Vault.sol", "src/Vault.sol"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeBlockedInput(input)).toBe(expected)
  })

  test("bounds very long inputs", () => {
    expect(normalizeBlockedInput("a/".repeat(500)).length).toBeLessThan(300)
  })

  test("the sink normalizes the input of a security.blocked event before it is stored", async () => {
    const { sink } = await setup()
    const result = await sink.append("security.blocked", { ruleId: "snapshot.absolute_path", input: " /etc/passwd " })
    if (result.kind !== "appended") throw new Error("expected an append")
    expect(result.event.payload.input).toBe(AbsolutePathRedactedPlaceholder)
    expect(result.event.payloadDigest).toBe(
      digestOf({ ruleId: "snapshot.absolute_path", input: AbsolutePathRedactedPlaceholder }),
    )
  })
})
