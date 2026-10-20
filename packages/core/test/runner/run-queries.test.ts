import { describe, expect, test } from "bun:test"
import type { RunRecord, RunStorePort, TrajectoryEvent } from "@harness/protocol"
import { InMemoryRunStore } from "../../src/testing/in-memory-run-store"
import { getMultiTurnExecutionSummary, getRun, getRunHistory } from "../../src/runner/run-queries"

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
        eventId: "evt-1",
        sequence: 1,
        runId,
        schemaVersion: 1,
        occurredAt: "2026-10-14T10:00:01.000Z",
        type: "run.queued",
        payload: { prompt: "hello" },
        payloadDigest: "digest-1",
      }
      const event2: TrajectoryEvent = {
        eventId: "evt-2",
        sequence: 2,
        runId,
        schemaVersion: 1,
        occurredAt: "2026-10-14T10:00:02.000Z",
        type: "run.started",
        payload: { callIndex: 1 },
        payloadDigest: "digest-2",
      }
      const event3: TrajectoryEvent = {
        eventId: "evt-3",
        sequence: 3,
        runId,
        schemaVersion: 1,
        occurredAt: "2026-10-14T10:00:03.000Z",
        type: "run.completed",
        payload: { state: "completed" },
        payloadDigest: "digest-3",
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

  describe("getMultiTurnExecutionSummary", () => {
    test("reconstructs ordered turns, tool calls, results and snapshot link from events and attempts", async () => {
      const { getMultiTurnExecutionSummary } = require("../../src/runner/run-queries")
      const store = new InMemoryRunStore({ clock: { nowMs: () => 1000 } })
      store.seedRun("run-summary-1", "queued", "Test prompt", "snap-solidity-1")

      // Seed attempts
      await store.recordModelAttempt({
        id: "att-1",
        runId: "run-summary-1",
        stepIndex: 1,
        attemptPurpose: "reasoning",
        attemptNumber: 1,
        provider: "openai",
        model: "gpt-4o",
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
        costUsd: "0.001",
        latencyMs: 120,
        requestJson: {},
      })

      const claimResult = await store.claim({ runId: "run-summary-1", workerId: "worker" })
      if (claimResult.kind !== "claimed") throw new Error("claim failed")

      // Append events
      await store.appendEvent({
        claim: claimResult.claim,
        expectedStateVersion: claimResult.stateVersion,
        event: {
          eventId: "e1",
          type: "tool.requested",
          schemaVersion: 1,
          payload: { callIndex: 0, callId: "c1", toolName: "read_file", arguments: { path: "Vault.sol" } },
          payloadDigest: "d1",
          occurredAt: "2026-10-18T10:00:01.000Z",
        },
      })

      await store.appendEvent({
        claim: claimResult.claim,
        expectedStateVersion: claimResult.stateVersion,
        event: {
          eventId: "e2",
          type: "tool.completed",
          schemaVersion: 1,
          payload: { callIndex: 0, callId: "c1", toolName: "read_file", durationMs: 15, isTruncated: false, itemId: "itm-1" },
          payloadDigest: "d2",
          occurredAt: "2026-10-18T10:00:02.000Z",
        },
      })

      const summary = await getMultiTurnExecutionSummary("run-summary-1", store)
      expect(summary).toBeDefined()
      expect(summary?.snapshotId).toBe("snap-solidity-1")
      expect(summary?.toolCalls).toHaveLength(1)
      expect(summary?.toolCalls[0].toolName).toBe("read_file")
      expect(summary?.toolCalls[0].status).toBe("completed")
      expect(summary?.attempts).toHaveLength(1)
      expect(summary?.attempts[0].stepIndex).toBe(1)
    })
  })
})

  test("reconstructs repeated call IDs independently for each step", async () => {
  const runId = "run-reused-call-id"
  const makeEvent = (
    sequence: number,
    type: TrajectoryEvent["type"],
    payload: Record<string, unknown>,
  ): TrajectoryEvent => ({
    eventId: `event-${sequence}`,
    runId,
    sequence,
    type,
    schemaVersion: 1,
    payload,
    payloadDigest: `sha256:${"0".repeat(64)}`,
    occurredAt: "2026-10-18T10:00:00.000Z",
  })
  const resultItem = (turn: number, content: string) => ({
    item: {
      id: `result-${turn}`,
      turn,
      type: "tool_result",
      isPinned: false,
      content,
      toolMeta: { callId: "c1", toolName: "read_file", isError: false },
    },
  })
  const events = [
    makeEvent(1, "step.started", { stepIndex: 1, toolsDisabled: false }),
    makeEvent(2, "tool.requested", {
      callIndex: 0,
      callId: "c1",
      toolName: "read_file",
      arguments: { path: "one.sol" },
    }),
    makeEvent(3, "context.item_added", resultItem(1, "first result")),
    makeEvent(4, "tool.completed", {
      callIndex: 0,
      callId: "c1",
      toolName: "read_file",
      durationMs: 1,
      isTruncated: false,
      itemId: "result-1",
    }),
    makeEvent(5, "step.started", { stepIndex: 2, toolsDisabled: false }),
    makeEvent(6, "tool.requested", {
      callIndex: 0,
      callId: "c1",
      toolName: "read_file",
      arguments: { path: "two.sol" },
    }),
    makeEvent(7, "context.item_added", resultItem(2, "second result")),
    makeEvent(8, "tool.completed", {
      callIndex: 0,
      callId: "c1",
      toolName: "read_file",
      durationMs: 1,
      isTruncated: false,
      itemId: "result-2",
    }),
  ]
  const fakeStore = {
    async loadRun() {
      return { runId, state: "running", stateVersion: 1 } satisfies RunRecord
    },
    async loadEvents() {
      return events
    },
  } as unknown as RunStorePort

  const summary = await getMultiTurnExecutionSummary(runId, fakeStore)

  expect(summary?.toolCalls).toHaveLength(2)
  expect(summary?.toolCalls.map((item) => item.stepIndex)).toEqual([1, 2])
  expect(summary?.toolCalls.map((item) => item.resultContent)).toEqual(["first result", "second result"])
})

test("correlates allocations with provider usage and omits raw readback content", async () => {
  const runId = "run-context-readback"
  const event = (sequence: number, type: TrajectoryEvent["type"], payload: Record<string, unknown>): TrajectoryEvent => ({
    eventId: `event-${sequence}`, runId, sequence, type, schemaVersion: 1, payload,
    payloadDigest: `sha256:${"0".repeat(64)}`, occurredAt: "2026-10-18T10:00:00.000Z",
  })
  const events = [
    event(1, "context.transformed", { action: "truncated", targetItemId: "item-1", tokensBefore: 100, tokensAfter: 40, replacementNote: "bounded" }),
    event(2, "context.allocated", { stepIndex: 1, telemetry: { tokenizer: "o200k_base", policyVersion: "v1", estimatedInputTokens: 100, estimatedSafetyTokens: 120, windowLimitTokens: 16384, outputReserveTokens: 4096, tokensSaved: 60, budgetRemainingTokens: 16000, contentDigest: "content", requestDigest: `sha256:${"1".repeat(64)}`, actualUsage: null, usageDelta: null } }),
    event(3, "provider.attempted", { stepIndex: 1, purpose: "reasoning", attemptIndex: 0, profileId: "model", usage: { promptTokens: 90, completionTokens: 10, totalTokens: 100 }, costUsd: 0, latencyMs: 1, retryDecision: "none", backoffMs: 0 }),
  ]
  const store = { loadRun: async () => ({ runId, state: "completed", stateVersion: 1 } satisfies RunRecord), loadEvents: async () => events } as unknown as RunStorePort
  const summary = await getMultiTurnExecutionSummary(runId, store)
  expect(summary?.contextTelemetry[0]).toMatchObject({ actualUsage: { totalTokens: 100 }, usageDelta: 0 })
  expect(summary?.events).toHaveLength(3)
})

test("matches multiple allocations to one-based provider attempts in order", async () => {
  const runId = "run-context-retries"
  const make = (sequence: number, type: TrajectoryEvent["type"], payload: Record<string, unknown>): TrajectoryEvent => ({
    eventId: `e-${sequence}`, runId, sequence, type, schemaVersion: 1, payload,
    payloadDigest: `sha256:${"0".repeat(64)}`, occurredAt: "2026-10-18T10:00:00.000Z",
  })
  const telemetry = (estimatedInputTokens: number, digest: string) => ({ tokenizer: "o200k_base", policyVersion: "v1", estimatedInputTokens, estimatedSafetyTokens: estimatedInputTokens, windowLimitTokens: 16384, outputReserveTokens: 4096, tokensSaved: 0, budgetRemainingTokens: 16000, contentDigest: digest, requestDigest: `sha256:${digest.repeat(64).slice(0, 64)}`, actualUsage: null, usageDelta: null })
  const usage = (promptTokens: number, completionTokens: number, totalTokens: number) => ({ promptTokens, completionTokens, totalTokens })
  const events = [
    make(1, "context.allocated", { stepIndex: 1, telemetry: telemetry(100, "a") }),
    make(2, "provider.attempted", { stepIndex: 1, purpose: "reasoning", attemptIndex: 1, profileId: "model", usage: usage(110, 10, 120), costUsd: 0, latencyMs: 1, retryDecision: "retry", backoffMs: 1 }),
    make(3, "context.allocated", { stepIndex: 1, telemetry: telemetry(200, "b") }),
    make(4, "provider.attempted", { stepIndex: 1, purpose: "reasoning", attemptIndex: 2, profileId: "model", usage: null, costUsd: null, latencyMs: 1, retryDecision: "none", backoffMs: 0 }),
  ]
  const store = { loadRun: async () => ({ runId, state: "failed", stateVersion: 1 } satisfies RunRecord), loadEvents: async () => events } as unknown as RunStorePort
  const summary = await getMultiTurnExecutionSummary(runId, store)
  expect(summary?.contextTelemetry.map(({ actualUsage, usageDelta }) => ({ actualUsage, usageDelta }))).toEqual([
    { actualUsage: usage(110, 10, 120), usageDelta: 20 },
    { actualUsage: null, usageDelta: null },
  ])
})

test("does not attach ambiguous legacy zero-based usage to multiple allocations", async () => {
  const runId = "run-ambiguous-legacy"
  const event = (sequence: number, type: TrajectoryEvent["type"], payload: Record<string, unknown>): TrajectoryEvent => ({
    eventId: `e-${sequence}`, runId, sequence, type, schemaVersion: 1, payload,
    payloadDigest: `sha256:${"0".repeat(64)}`, occurredAt: "2026-10-18T10:00:00.000Z",
  })
  const telemetry = (estimatedInputTokens: number) => ({ tokenizer: "o200k_base", policyVersion: "v1", estimatedInputTokens, estimatedSafetyTokens: estimatedInputTokens, windowLimitTokens: 16384, outputReserveTokens: 4096, tokensSaved: 0, budgetRemainingTokens: 16000, contentDigest: "content", actualUsage: null, usageDelta: null })
  const events = [
    event(1, "context.allocated", { stepIndex: 1, telemetry: telemetry(100) }),
    event(2, "context.allocated", { stepIndex: 1, telemetry: telemetry(200) }),
    event(3, "provider.attempted", { stepIndex: 1, purpose: "reasoning", attemptIndex: 0, profileId: "model", usage: { promptTokens: 999, completionTokens: 1, totalTokens: 1000 }, costUsd: 0, latencyMs: 1, retryDecision: "none", backoffMs: 0 }),
  ]
  const store = { loadRun: async () => ({ runId, state: "failed", stateVersion: 1 } satisfies RunRecord), loadEvents: async () => events } as unknown as RunStorePort
  const summary = await getMultiTurnExecutionSummary(runId, store)
  expect(summary?.contextTelemetry.map((item) => item.actualUsage)).toEqual([null, null])
})
