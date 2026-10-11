import { describe, expect, test } from "bun:test"
import {
  EventSchemaVersion,
  type EventType,
  type NewTrajectoryEvent,
  type RunState,
  type RunStorePort,
  type TerminalReason,
  type TerminalRunState,
} from "@harness/protocol"
import { digestOf } from "../util/digest"

/** What an adapter must give the contract tests: the store plus two things the port itself cannot do. */
export interface RunStoreHarness {
  store: RunStorePort
  /** Creates a run in a non-terminal state that the store can then be asked to claim. */
  seedRun(runId: string, state?: RunState): Promise<void>
  /** Makes every live claim lease count as expired, so another worker may claim. */
  expireLeases(): Promise<void>
}

export const newTestEvent = (label: string, type: EventType = "run.accepted"): NewTrajectoryEvent => {
  const payload = { label }
  return {
    eventId: `evt-${label}`,
    type,
    schemaVersion: EventSchemaVersion,
    payload,
    payloadDigest: digestOf(payload),
    occurredAt: "2026-01-01T00:00:00.000Z",
  }
}

const terminalCases: ReadonlyArray<{ state: TerminalRunState; reason?: TerminalReason }> = [
  { state: "completed" },
  { state: "failed", reason: "persistence_failure" },
  { state: "cancelled", reason: "cancelled_by_user" },
  { state: "budget_exhausted", reason: "max_steps" },
]

/**
 * Conformance tests every `RunStorePort` implementation must pass. The in-memory fake runs them in this package;
 * the PostgreSQL adapter runs the same function against a real database.
 */
export const runStoreContractTests = (makeHarness: () => RunStoreHarness | Promise<RunStoreHarness>) =>
  describe("RunStorePort contract", () => {
    const claimRun = async (harness: RunStoreHarness, runId: string, workerId: string) => {
      const result = await harness.store.claim({ runId, workerId })
      if (result.kind !== "claimed") throw new Error(`expected ${workerId} to claim ${runId}, got ${result.reason}`)
      return result
    }

    const startRunning = async (harness: RunStoreHarness, runId: string, workerId = "worker-a") => {
      await harness.seedRun(runId, "queued")
      const claimed = await claimRun(harness, runId, workerId)
      const started = await harness.store.transition({
        claim: claimed.claim,
        expectedState: claimed.state,
        expectedStateVersion: claimed.stateVersion,
        nextState: "running",
      })
      if (started.kind !== "transitioned") throw new Error("expected the first transition to succeed")
      return { claim: claimed.claim, stateVersion: started.stateVersion }
    }

    describe("claims", () => {
      test("an unknown run is unavailable as not_found", async () => {
        const harness = await makeHarness()
        expect(await harness.store.claim({ runId: "missing", workerId: "worker-a" })).toEqual({
          kind: "unavailable",
          reason: "not_found",
        })
      })

      test("a seeded run is claimed with its state, state version and a claim", async () => {
        const harness = await makeHarness()
        await harness.seedRun("run-1", "queued")
        const claimed = await claimRun(harness, "run-1", "worker-a")
        expect(claimed.state).toBe("queued")
        expect(claimed.claim.runId).toBe("run-1")
        expect(claimed.claim.claimToken.length).toBeGreaterThan(0)
        expect(claimed.claim.claimVersion).toBeGreaterThanOrEqual(1)
        expect(await harness.store.loadRun("run-1")).toMatchObject({
          runId: "run-1",
          state: "queued",
          stateVersion: claimed.stateVersion,
        })
      })

      test("a live claim blocks every other claim as already_claimed", async () => {
        const harness = await makeHarness()
        await harness.seedRun("run-1")
        await claimRun(harness, "run-1", "worker-a")
        expect(await harness.store.claim({ runId: "run-1", workerId: "worker-b" })).toEqual({
          kind: "unavailable",
          reason: "already_claimed",
        })
      })

      test("an expired lease can be claimed again with a higher claim version and a new token", async () => {
        const harness = await makeHarness()
        await harness.seedRun("run-1")
        const first = await claimRun(harness, "run-1", "worker-a")
        await harness.expireLeases()
        const second = await claimRun(harness, "run-1", "worker-b")
        expect(second.claim.claimVersion).toBeGreaterThan(first.claim.claimVersion)
        expect(second.claim.claimToken).not.toBe(first.claim.claimToken)
      })
    })

    describe("stale claims", () => {
      test("worker A cannot append or transition after worker B took over, and nothing changes", async () => {
        const harness = await makeHarness()
        const { store } = harness
        await harness.seedRun("run-1")
        const workerA = await claimRun(harness, "run-1", "worker-a")
        await harness.expireLeases()
        await claimRun(harness, "run-1", "worker-b")
        const before = await store.loadRun("run-1")

        expect(
          await store.appendEvent({
            claim: workerA.claim,
            expectedStateVersion: workerA.stateVersion,
            event: newTestEvent("from-a"),
          }),
        ).toEqual({ kind: "stale", reason: "claim_lost" })
        expect(
          await store.transition({
            claim: workerA.claim,
            expectedState: workerA.state,
            expectedStateVersion: workerA.stateVersion,
            nextState: "running",
          }),
        ).toEqual({ kind: "stale", reason: "claim_lost" })

        expect(await store.loadEvents({ runId: "run-1" })).toEqual([])
        expect(await store.loadRun("run-1")).toEqual(before)
      })

      test("the new owner keeps writing after the old owner was refused", async () => {
        const harness = await makeHarness()
        await harness.seedRun("run-1")
        const workerA = await claimRun(harness, "run-1", "worker-a")
        await harness.expireLeases()
        const workerB = await claimRun(harness, "run-1", "worker-b")
        await harness.store.appendEvent({
          claim: workerA.claim,
          expectedStateVersion: workerA.stateVersion,
          event: newTestEvent("from-a"),
        })
        const appended = await harness.store.appendEvent({
          claim: workerB.claim,
          expectedStateVersion: workerB.stateVersion,
          event: newTestEvent("from-b"),
        })
        expect(appended.kind).toBe("appended")
        expect((await harness.store.loadEvents({ runId: "run-1" })).map((event) => event.eventId)).toEqual([
          "evt-from-b",
        ])
      })

      test("a forged token and an old claim version are both rejected", async () => {
        const harness = await makeHarness()
        await harness.seedRun("run-1")
        const first = await claimRun(harness, "run-1", "worker-a")
        await harness.expireLeases()
        const second = await claimRun(harness, "run-1", "worker-b")
        const event = newTestEvent("forged")
        const forged = { ...second.claim, claimToken: `${second.claim.claimToken}-forged` }
        const outdated = { ...second.claim, claimVersion: first.claim.claimVersion }
        for (const claim of [forged, outdated])
          expect(await harness.store.appendEvent({ claim, expectedStateVersion: second.stateVersion, event })).toEqual({
            kind: "stale",
            reason: "claim_lost",
          })
        expect(await harness.store.loadEvents({ runId: "run-1" })).toEqual([])
      })

      test("a claim for another run is rejected", async () => {
        const harness = await makeHarness()
        await harness.seedRun("run-1")
        await harness.seedRun("run-2")
        const first = await claimRun(harness, "run-1", "worker-a")
        const result = await harness.store.appendEvent({
          claim: { ...first.claim, runId: "run-2" },
          expectedStateVersion: first.stateVersion,
          event: newTestEvent("cross-run"),
        })
        expect(result).toEqual({ kind: "stale", reason: "claim_lost" })
        expect(await harness.store.loadEvents({ runId: "run-2" })).toEqual([])
      })
    })

    describe("event sequence", () => {
      test("sequences start at 1 and are contiguous in append order", async () => {
        const harness = await makeHarness()
        const { claim, stateVersion } = await startRunning(harness, "run-1")
        for (const label of ["a", "b", "c"])
          await harness.store.appendEvent({ claim, expectedStateVersion: stateVersion, event: newTestEvent(label) })
        const events = await harness.store.loadEvents({ runId: "run-1" })
        expect(events.map((event) => [event.sequence, event.eventId])).toEqual([
          [1, "evt-a"],
          [2, "evt-b"],
          [3, "evt-c"],
        ])
        expect(events.every((event) => event.runId === "run-1")).toBe(true)
      })

      test("concurrent appends never duplicate or skip a sequence", async () => {
        const harness = await makeHarness()
        const { claim, stateVersion } = await startRunning(harness, "run-1")
        const labels = Array.from({ length: 12 }, (_, index) => `c${index}`)
        const results = await Promise.all(
          labels.map((label) =>
            harness.store.appendEvent({ claim, expectedStateVersion: stateVersion, event: newTestEvent(label) }),
          ),
        )
        expect(results.every((result) => result.kind === "appended")).toBe(true)
        const events = await harness.store.loadEvents({ runId: "run-1" })
        expect(events.map((event) => event.sequence)).toEqual(labels.map((_, index) => index + 1))
        expect(new Set(events.map((event) => event.eventId)).size).toBe(labels.length)
      })

      test("sequences are per run", async () => {
        const harness = await makeHarness()
        const one = await startRunning(harness, "run-1")
        const two = await startRunning(harness, "run-2", "worker-b")
        await harness.store.appendEvent({
          claim: one.claim,
          expectedStateVersion: one.stateVersion,
          event: newTestEvent("x"),
        })
        const second = await harness.store.appendEvent({
          claim: two.claim,
          expectedStateVersion: two.stateVersion,
          event: newTestEvent("y"),
        })
        expect(second.kind === "appended" && second.event.sequence).toBe(1)
      })

      test("loadEvents afterSequence returns only the later events", async () => {
        const harness = await makeHarness()
        const { claim, stateVersion } = await startRunning(harness, "run-1")
        for (const label of ["a", "b", "c", "d"])
          await harness.store.appendEvent({ claim, expectedStateVersion: stateVersion, event: newTestEvent(label) })
        const tail = await harness.store.loadEvents({ runId: "run-1", afterSequence: 2 })
        expect(tail.map((event) => event.sequence)).toEqual([3, 4])
        expect(await harness.store.loadEvents({ runId: "run-1", afterSequence: 4 })).toEqual([])
      })

      test("an append against an old state version is stale and writes nothing", async () => {
        const harness = await makeHarness()
        const { claim, stateVersion } = await startRunning(harness, "run-1")
        const result = await harness.store.appendEvent({
          claim,
          expectedStateVersion: stateVersion - 1,
          event: newTestEvent("late"),
        })
        expect(result).toEqual({ kind: "stale", reason: "state_changed" })
        expect(await harness.store.loadEvents({ runId: "run-1" })).toEqual([])
      })

      test("an unknown run loads as undefined with no events", async () => {
        const harness = await makeHarness()
        expect(await harness.store.loadRun("missing")).toBeUndefined()
        expect(await harness.store.loadEvents({ runId: "missing" })).toEqual([])
      })
    })

    describe("compare-and-set transitions", () => {
      test("a matching transition advances the state and the version", async () => {
        const harness = await makeHarness()
        await harness.seedRun("run-1", "queued")
        const claimed = await claimRun(harness, "run-1", "worker-a")
        const result = await harness.store.transition({
          claim: claimed.claim,
          expectedState: "queued",
          expectedStateVersion: claimed.stateVersion,
          nextState: "running",
        })
        expect(result).toEqual({ kind: "transitioned", stateVersion: claimed.stateVersion + 1 })
        expect(await harness.store.loadRun("run-1")).toMatchObject({
          state: "running",
          stateVersion: claimed.stateVersion + 1,
        })
      })

      test("a wrong expected state or version is stale as state_changed and changes nothing", async () => {
        const harness = await makeHarness()
        const { claim, stateVersion } = await startRunning(harness, "run-1")
        const wrongState = await harness.store.transition({
          claim,
          expectedState: "queued",
          expectedStateVersion: stateVersion,
          nextState: "completed",
        })
        const wrongVersion = await harness.store.transition({
          claim,
          expectedState: "running",
          expectedStateVersion: stateVersion - 1,
          nextState: "completed",
        })
        expect(wrongState).toEqual({ kind: "stale", reason: "state_changed" })
        expect(wrongVersion).toEqual({ kind: "stale", reason: "state_changed" })
        expect(await harness.store.loadRun("run-1")).toMatchObject({ state: "running", stateVersion })
      })

      test("of two racing transitions with the same expectation exactly one wins", async () => {
        const harness = await makeHarness()
        const { claim, stateVersion } = await startRunning(harness, "run-1")
        const attempt = (nextState: RunState, terminalReason?: TerminalReason) =>
          harness.store.transition({
            claim,
            expectedState: "running",
            expectedStateVersion: stateVersion,
            nextState,
            terminalReason,
          })
        const results = await Promise.all([attempt("completed"), attempt("failed", "persistence_failure")])
        expect(results.filter((result) => result.kind === "transitioned")).toHaveLength(1)
        expect(results.filter((result) => result.kind === "stale")).toHaveLength(1)
      })
    })

    describe("terminal immutability", () => {
      for (const { state, reason } of terminalCases)
        test(`a ${state} run rejects every later transition, append and claim`, async () => {
          const harness = await makeHarness()
          const { claim, stateVersion } = await startRunning(harness, "run-1")
          const committed = await harness.store.transition({
            claim,
            expectedState: "running",
            expectedStateVersion: stateVersion,
            nextState: state,
            terminalReason: reason,
          })
          if (committed.kind !== "transitioned") throw new Error("expected the terminal transition to succeed")

          // The reason is not pinned: an adapter may release the claim at the terminal commit (claim_lost).
          for (const nextState of ["running", "queued", "failed", "completed"] as const)
            expect(
              await harness.store.transition({
                claim,
                expectedState: state,
                expectedStateVersion: committed.stateVersion,
                nextState,
                terminalReason: "persistence_failure",
              }),
            ).toMatchObject({ kind: "stale" })
          expect(
            await harness.store.appendEvent({
              claim,
              expectedStateVersion: committed.stateVersion,
              event: newTestEvent("after-terminal"),
            }),
          ).toMatchObject({ kind: "stale" })
          expect(await harness.store.claim({ runId: "run-1", workerId: "worker-b" })).toEqual({
            kind: "unavailable",
            reason: "terminal",
          })
          await harness.expireLeases()
          expect(await harness.store.claim({ runId: "run-1", workerId: "worker-b" })).toEqual({
            kind: "unavailable",
            reason: "terminal",
          })

          const record = await harness.store.loadRun("run-1")
          expect(record).toMatchObject({ state, stateVersion: committed.stateVersion })
          expect(record?.terminalReason).toBe(reason)
          expect(await harness.store.loadEvents({ runId: "run-1" })).toEqual([])
        })
    })
  })
