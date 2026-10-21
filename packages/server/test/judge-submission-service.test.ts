import { describe, expect, test } from "bun:test"
import { createIdGenerator, digestOf } from "@harness/core"
import { InMemorySnapshot } from "@harness/core"
import { createJudgeSubmissionService, loadAdmittedJudgeInput } from "../src/judge-submission-service"
import { createOutboxWorker } from "../src/outbox-worker"

describe("Judge submission service", () => {
  test("resolves snapshot and atomically admits canonical finding/config with idempotency key", async () => {
    const calls: unknown[] = []
    const snapshot = new InMemorySnapshot({ snapshotId: "snapshot-1", files: { "src/Vault.sol": "contract Vault {}" } })
    const store = {
      admit: async (input: unknown) => {
        calls.push(input)
        return { kind: "accepted" as const, runId: "run-fixed" }
      },
    }
    const service = createJudgeSubmissionService({
      store: store as never,
      snapshots: snapshot,
      ids: createIdGenerator({ clock: () => 1, random: (size) => new Uint8Array(size) }),
      config: { profileId: "p1", maxSteps: 8 },
    })
    const request = {
      finding: { findingId: "finding-1", reportMarkdown: "Possible reentrancy." },
      snapshotId: "snapshot-1",
      idempotencyKey: "key-1",
    }
    expect(await service.submit(request)).toEqual({ kind: "accepted", runId: "run-fixed" })
    expect(calls).toEqual([{
      runId: "run_00000000100100000000000000",
      findingId: "finding-1",
      reportMarkdown: "Possible reentrancy.",
      snapshotId: "snapshot-1",
      config: { profileId: "p1", maxSteps: 8 },
      idempotencyKey: "key-1",
      requestDigest: digestOf({
        finding: request.finding,
        snapshotId: "snapshot-1",
        config: { profileId: "p1", maxSteps: 8 },
      }),
    }])
  })

  test("does not admit a missing snapshot", async () => {
    let admissions = 0
    const service = createJudgeSubmissionService({
      store: { admit: async () => { admissions++; return { kind: "accepted", runId: "run-x" } } } as never,
      snapshots: new InMemorySnapshot({ snapshotId: "snapshot-present", files: { "A.sol": "contract A {}" } }),
      ids: createIdGenerator({ clock: () => 1, random: (size) => new Uint8Array(size) }),
      config: {},
    })
    expect(await service.submit({
      finding: { findingId: "finding-1", reportMarkdown: "Report" },
      snapshotId: "missing",
      idempotencyKey: "key-1",
    })).toEqual({ kind: "not_found", resource: "snapshot" })
    expect(admissions).toBe(0)
  })

  test("same idempotency key and canonical request reuse the original accepted run", async () => {
    let admissions = 0
    const snapshot = new InMemorySnapshot({ snapshotId: "snapshot-1", files: { "A.sol": "contract A {}" } })
    const service = createJudgeSubmissionService({
      store: {
        admit: async (input: { requestDigest: string }) => {
          admissions++
          return admissions === 1
            ? { kind: "accepted" as const, runId: "run-original" }
            : { kind: "replayed" as const, runId: "run-original" }
        },
      } as never,
      snapshots: snapshot,
      ids: createIdGenerator({ clock: () => 1, random: (size) => new Uint8Array(size) }),
      config: { profileId: "p1" },
    })
    const request = {
      finding: { findingId: "finding-1", reportMarkdown: "Report" },
      snapshotId: "snapshot-1",
      idempotencyKey: "same-key",
    }
    const [first, replay] = await Promise.all([service.submit(request), service.submit(request)])
    expect(first).toEqual({ kind: "accepted", runId: "run-original" })
    expect(replay).toEqual({ kind: "replayed", runId: "run-original" })
    expect(admissions).toBe(2)
  })

  test("concurrent submissions bind to one persistent run ID, not each request's candidate ID", async () => {
    const byKey = new Map<string, { digest: string; runId: string }>()
    let nextId = 0
    const snapshot = new InMemorySnapshot({ snapshotId: "snapshot-1", files: { "A.sol": "contract A {}" } })
    const service = createJudgeSubmissionService({
      store: {
        admit: async (input: { runId: string; idempotencyKey: string; requestDigest: string }) => {
          const existing = byKey.get(input.idempotencyKey)
          if (existing)
            return existing.digest === input.requestDigest
              ? { kind: "replayed" as const, runId: existing.runId }
              : { kind: "conflict" as const }
          await Promise.resolve()
          const raced = byKey.get(input.idempotencyKey)
          if (raced) return raced.digest === input.requestDigest
            ? { kind: "replayed" as const, runId: raced.runId }
            : { kind: "conflict" as const }
          const accepted = { digest: input.requestDigest, runId: `db-run-${++nextId}` }
          byKey.set(input.idempotencyKey, accepted)
          return { kind: "accepted" as const, runId: accepted.runId }
        },
      } as never,
      snapshots: snapshot,
      ids: createIdGenerator({ clock: () => 1, random: (size) => new Uint8Array(size) }),
      config: { profileId: "p1" },
    })
    const request = {
      finding: { findingId: "finding-1", reportMarkdown: "Report" },
      snapshotId: "snapshot-1",
      idempotencyKey: "race-key",
    }
    const results = await Promise.all([service.submit(request), service.submit(request)])
    expect(results).toEqual([
      { kind: "accepted", runId: "db-run-1" },
      { kind: "replayed", runId: "db-run-1" },
    ])
  })

  test("outbox worker dispatches only stable run ID and is independent of request abort", async () => {
    const order: string[] = []
    const store = {
      loadPendingOutbox: async () => ["run-durable"],
      claimOutbox: async (runId: string) => { order.push(`outbox:${runId}`); return true },
      markOutboxPublished: async (runId: string) => { order.push(`published:${runId}`); return true },
      claim: async ({ runId, workerId }: { runId: string; workerId: string }) => {
        order.push(`claim:${runId}:${workerId}`)
        return { kind: "claimed" as const, claim: { runId, claimToken: "claim", claimVersion: 1 }, state: "queued" as const, stateVersion: 1 }
      },
    }
    const worker = createOutboxWorker({
      store: store as never,
      workerId: "worker-1",
      execute: async (runId) => { order.push(`execute:${runId}`) },
    })
    const disconnectedRequest = new AbortController()
    disconnectedRequest.abort()
    await worker.runOnce()
    expect(order).toEqual([
      "outbox:run-durable",
      "claim:run-durable:worker-1",
      "execute:run-durable",
      "published:run-durable",
    ])
  })

  test("worker reloads finding, snapshot and frozen config from admitted run", async () => {
    const result = await loadAdmittedJudgeInput({
      loadRun: async () => ({
        runId: "run-1",
        state: "queued",
        stateVersion: 1,
        findingId: "finding-1",
        prompt: "Report body",
        snapshotId: "snapshot-1",
        configSnapshot: { profileId: "frozen-profile" },
      }),
    } as never, "run-1")
    expect(result).toEqual({
      finding: { findingId: "finding-1", reportMarkdown: "Report body" },
      snapshotId: "snapshot-1",
      config: { profileId: "frozen-profile" },
    })
  })

  test("worker leaves outbox claim recoverable when execution throws", async () => {
    const order: string[] = []
    const worker = createOutboxWorker({
      store: {
        loadPendingOutbox: async () => ["run-failed"],
        claimOutbox: async () => true,
        markOutboxPublished: async () => { order.push("published"); return true },
        claim: async () => ({ kind: "claimed", claim: { runId: "run-failed", claimToken: "c", claimVersion: 1 }, state: "queued", stateVersion: 1 }),
      } as never,
      workerId: "worker-1",
      execute: async () => { throw new Error("runner failed") },
    })
    await expect(worker.runOnce()).rejects.toThrow("runner failed")
    expect(order).toEqual([])
  })

})
