import { describe, expect, test } from "bun:test"
import { executeViewCommand } from "../src/commands/view"
import { InMemoryRunStore } from "@harness/core/testing"
import { digestOf } from "@harness/core"

describe("executeViewCommand", () => {
  test("fails when id flag is missing", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const { exitCode, output } = await executeViewCommand({ id: "" }, { store })

    expect(exitCode).toBe(1)
    expect(output).toContain("Error: --id <runId> is required")
  })

  test("reports error when run is not found in store", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const { exitCode, output } = await executeViewCommand({ id: "run-unknown-999" }, { store })

    expect(exitCode).toBe(1)
    expect(output).toContain("Error: Run 'run-unknown-999' not found")
  })

  test("displays run details and chronological trajectory events for existing run", async () => {
    const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
    const runId = "run-test-101"
    const workerId = "test-worker"

    // Set up existing run and events in store
    store.seedRun(runId, "queued")
    const claimResult = await store.claim({ runId, workerId })
    if (claimResult.kind !== "claimed") throw new Error("claim failed")

    const eventPayload = { prompt: "Test prompt inspection" }
    await store.appendEvent({
      claim: claimResult.claim,
      expectedStateVersion: claimResult.stateVersion,
      event: {
        eventId: "evt-101",
        type: "run.queued",
        schemaVersion: 1,
        payload: eventPayload,
        payloadDigest: digestOf(eventPayload),
        occurredAt: new Date(1700000000000).toISOString(),
      },
    })
    await store.transition({
      claim: claimResult.claim,
      expectedState: "queued",
      expectedStateVersion: claimResult.stateVersion,
      nextState: "completed",
    })
    const { exitCode, output } = await executeViewCommand({ id: runId }, { store })

    expect(exitCode).toBe(0)
    expect(output).toContain("Run Inspection Record")
    expect(output).toContain(`Run ID:       ${runId}`)
    expect(output).toContain("State:        completed")
    expect(output).toContain("run.queued")
    expect(output).toContain("Test prompt inspection")
  })
})
