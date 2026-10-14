import { describe, expect, test } from "bun:test"
import type { RunRecord, TrajectoryEvent } from "@harness/protocol"
import { InMemoryRunStore } from "../../src/testing/in-memory-run-store"
import { getRun, getRunHistory } from "../../src/runner/run-queries"

describe("run-queries", () => {
  describe("getRun", () => {
    test("returns null for non-existent run", async () => {
      const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
      const result = await getRun("non-existent-run-id", store)
      expect(result).toBeNull()
    })

    test("returns RunRecord for existing run", async () => {
      const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
      store.seedRun("run-123", "queued")

      const result = await getRun("run-123", store)
      expect(result).toBeDefined()
      expect(result?.runId).toBe("run-123")
      expect(result?.state).toBe("queued")
    })
  })

  describe("getRunHistory", () => {
    test("returns empty array when no events exist for run", async () => {
      const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
      const events = await getRunHistory("run-empty", store)
      expect(events).toEqual([])
    })

    test("returns events sorted in strictly ascending sequence order even if store returns out of order", async () => {
      const runId = "run-events-order"
      const event1: TrajectoryEvent = {
        sequence: 1,
        runId,
        occurredAt: "2026-10-14T10:00:01.000Z",
        type: "run.queued",
        payload: { prompt: "hello" },
      }
      const event2: TrajectoryEvent = {
        sequence: 2,
        runId,
        occurredAt: "2026-10-14T10:00:02.000Z",
        type: "run.started",
        payload: { callIndex: 1 },
      }
      const event3: TrajectoryEvent = {
        sequence: 3,
        runId,
        occurredAt: "2026-10-14T10:00:03.000Z",
        type: "run.completed",
        payload: { state: "completed" },
      }

      // Mock store that returns out-of-order events
      const mockStore = {
        loadRun: async () => undefined,
        claim: async () => ({ kind: "unavailable" as const, reason: "not_found" as const }),
        appendEvent: async () => ({ kind: "stale" as const, reason: "claim_lost" as const }),
        transition: async () => ({ kind: "stale" as const, reason: "claim_lost" as const }),
        loadEvents: async () => [event3, event1, event2],
      }

      const history = await getRunHistory(runId, mockStore)
      expect(history.map((e) => e.sequence)).toEqual([1, 2, 3])
      expect(history).toEqual([event1, event2, event3])
    })
  })
})
