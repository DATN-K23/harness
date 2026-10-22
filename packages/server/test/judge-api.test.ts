import { describe, expect, test } from "bun:test"
import { createJudgeApi } from "../src/judge-api"

describe("Judge submission API", () => {
  test("health endpoint returns authenticated API compatibility identity", async () => {
    const app = createJudgeApi({ credential: "test-credential", submit: async () => ({ kind: "accepted", runId: "r" }) })
    const response = await app.fetch(new Request("http://localhost/v1/health", { headers: { authorization: "Bearer test-credential" } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      endpointId: "harness-local-runtime",
      apiVersion: 1,
      buildVersion: "1",
      capabilities: ["judge-submit", "run-query", "event-poll", "cancellation"],
    })
  })

  test("returns 202 only after durable submit has accepted finding and snapshot", async () => {
    let accepted = false
    const app = createJudgeApi({
      credential: "test-credential",
      submit: async ({ finding, snapshotId }) => {
        expect(accepted).toBe(false)
        expect(finding.findingId).toBe("finding-1")
        expect(snapshotId).toBe("snapshot-1")
        accepted = true
        return { kind: "accepted", runId: "run-1" }
      },
    })
    const response = await app.fetch(new Request("http://localhost/v1/judge/runs", {
      method: "POST",
      headers: { authorization: "Bearer test-credential", "content-type": "application/json", "idempotency-key": "key-1" },
      body: JSON.stringify({
        finding: { findingId: "finding-1", reportMarkdown: "Possible reentrancy." },
        snapshotId: "snapshot-1",
      }),
    }))
    expect(response.status).toBe(202)
    expect(response.headers.get("location")).toBe("/v1/judge/runs/run-1")
    expect(await response.json()).toEqual({ runId: "run-1", state: "accepted", statusUrl: "/v1/judge/runs/run-1" })
    expect(accepted).toBe(true)
  })

  test("rejects API requests without a credential before reading or admitting the body", async () => {
    let calls = 0
    const app = createJudgeApi({ credential: "installation-secret", submit: async () => { calls++; return { kind: "accepted", runId: "r" } } })
    const response = await app.fetch(new Request("http://localhost/v1/judge/runs", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "key-1" },
      body: "not even valid json",
    }))
    expect(response.status).toBe(401)
    expect(calls).toBe(0)
  })

  test("rejects invalid payload and unresolved snapshot before durable admission", async () => {
    let calls = 0
    const app = createJudgeApi({
      credential: "test-credential",
      submit: async () => {
        calls++
        return { kind: "accepted", runId: "unexpected" }
      },
    })
    const response = await app.fetch(new Request("http://localhost/v1/judge/runs", {
      method: "POST",
      headers: { authorization: "Bearer test-credential", "content-type": "application/json", "idempotency-key": "key-1" },
      body: JSON.stringify({ finding: { findingId: "", reportMarkdown: "" }, snapshotId: "missing" }),
    }))
    expect(response.status).toBe(400)
    expect(calls).toBe(0)
  })

  test("rejects recursively nested prohibited metadata before submission or trajectory admission", async () => {
    let submitCalls = 0
    let eventReads = 0
    const app = createJudgeApi({
      credential: "test-credential",
      submit: async () => { submitCalls++; return { kind: "accepted", runId: "unexpected" } },
      store: {
        loadEvents: async () => { eventReads++; return [] },
      } as never,
    })
    const response = await app.fetch(new Request("http://localhost/v1/judge/runs", {
      method: "POST",
      headers: { authorization: "Bearer test-credential", "content-type": "application/json", "idempotency-key": "key-gt" },
      body: JSON.stringify({
        finding: {
          findingId: "finding-gt",
          reportMarkdown: "Candidate only",
          nested: [{ adjudicationReport: { score: "test-only-sensitive-marker" } }],
        },
        snapshotId: "snapshot-1",
      }),
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } })
    expect(submitCalls).toBe(0)
    expect(eventReads).toBe(0)
  })

  test("returns conflict without issuing a run when idempotency digest differs", async () => {
    const app = createJudgeApi({ credential: "test-credential", submit: async () => ({ kind: "conflict" }) })
    const response = await app.fetch(new Request("http://localhost/v1/judge/runs", {
      method: "POST",
      headers: { authorization: "Bearer test-credential", "content-type": "application/json", "idempotency-key": "key-1" },
      body: JSON.stringify({
        finding: { findingId: "finding-1", reportMarkdown: "Different report" },
        snapshotId: "snapshot-1",
      }),
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: { code: "idempotency_conflict", message: "Idempotency key was used for a different request" } })
  })

  test("rejects malformed JSON and oversized bodies before admission", async () => {
    let calls = 0
    const app = createJudgeApi({ credential: "test-credential", submit: async () => { calls++; return { kind: "accepted", runId: "run-1" } } })
    const headers = { authorization: "Bearer test-credential", "content-type": "application/json", "idempotency-key": "key-1" }
    const malformed = await app.fetch(new Request("http://localhost/v1/judge/runs", {
      method: "POST", headers, body: "{not-json",
    }))
    const largeBody = await app.fetch(new Request("http://localhost/v1/judge/runs", {
      method: "POST", headers, body: JSON.stringify({ finding: { findingId: "x", reportMarkdown: "x".repeat(260_000) }, snapshotId: "s" }),
    }))
    expect(malformed.status).toBe(400)
    expect(largeBody.status).toBe(413)
    expect(calls).toBe(0)
  })

  test("returns unavailable without fabricating an invalid verdict when admission throws", async () => {
    const app = createJudgeApi({ credential: "test-credential", submit: async () => { throw new Error("database unavailable") } })
    const response = await app.fetch(new Request("http://localhost/v1/judge/runs", {
      method: "POST",
      headers: { authorization: "Bearer test-credential", "content-type": "application/json", "idempotency-key": "key-1" },
      body: JSON.stringify({ finding: { findingId: "finding-1", reportMarkdown: "Report" }, snapshotId: "snapshot-1" }),
    }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: { code: "execution_error", message: "Unable to accept Judge run" } })
  })

  test("returns safe run projection and hides private persistence fields", async () => {
    const app = createJudgeApi({
      credential: "test-credential",
      submit: async () => ({ kind: "accepted", runId: "run-1" }),
      store: {
        loadRun: async () => ({
          runId: "run-1",
          state: "running",
          stateVersion: 4,
          snapshotId: "snapshot-1",
          findingId: "finding-1",
          configSnapshot: { profileId: "profile-1" },
          claimToken: "private-claim",
          claimExpiresAt: "private-expiry",
        }),
      } as never,
    })
    const response = await app.fetch(new Request("http://localhost/v1/judge/runs/run-1", { headers: { authorization: "Bearer test-credential" } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      runId: "run-1",
      state: "running",
      stateVersion: 4,
      snapshotId: "snapshot-1",
      findingId: "finding-1",
    })
  })

  test("returns finite ordered event page with a cursor bound to the run", async () => {
    const app = createJudgeApi({
      credential: "test-credential",
      submit: async () => ({ kind: "accepted", runId: "run-1" }),
      cursorSecret: "test-cursor-secret",
      store: {
        loadRun: async (runId: string) => ({ runId, state: "running", stateVersion: 1 }),
        loadEvents: async ({ runId, afterSequence }: { runId: string; afterSequence: number }) => [
          { runId, sequence: 1, eventId: "e1", type: "run.queued", payload: {}, payloadDigest: "d", schemaVersion: 1, occurredAt: "2026-10-21T00:00:00.000Z" },
          { runId, sequence: 2, eventId: "e2", type: "run.started", payload: {}, payloadDigest: "d", schemaVersion: 1, occurredAt: "2026-10-21T00:00:01.000Z" },
        ].filter((event) => event.sequence > afterSequence),
      } as never,
    })
    const auth = { authorization: "Bearer test-credential" }
    const first = await app.fetch(new Request("http://localhost/v1/judge/runs/run-1/events?limit=1", { headers: auth }))
    expect(first.status).toBe(200)
    const firstBody = await first.json() as { events: { sequence: number }[]; nextCursor?: string }
    expect(firstBody.events.map(({ sequence }) => sequence)).toEqual([1])
    expect(firstBody.nextCursor).toBeString()
    const secondPage = await app.fetch(new Request(`http://localhost/v1/judge/runs/run-1/events?cursor=${encodeURIComponent(firstBody.nextCursor!)}`, { headers: auth }))
    expect(secondPage.status).toBe(200)
    expect(await secondPage.json()).toEqual({ events: [{
      runId: "run-1", sequence: 2, eventId: "e2", type: "run.started", payload: {}, payloadDigest: "d",
      schemaVersion: 1, occurredAt: "2026-10-21T00:00:01.000Z",
    }], nextCursor: null })
    const crossRun = await app.fetch(new Request(`http://localhost/v1/judge/runs/run-2/events?cursor=${encodeURIComponent(firstBody.nextCursor!)}`, { headers: auth }))
    expect(crossRun.status).toBe(400)
    const tamperedCursor = `${firstBody.nextCursor!.slice(0, -1)}x`
    const tampered = await app.fetch(new Request(`http://localhost/v1/judge/runs/run-1/events?cursor=${encodeURIComponent(tamperedCursor)}`, { headers: auth }))
    expect(tampered.status).toBe(400)
    const invalidLimit = await app.fetch(new Request("http://localhost/v1/judge/runs/run-1/events?limit=101", { headers: auth }))
    expect(invalidLimit.status).toBe(400)
  })

  test("unknown run returns not-found and never loads events", async () => {
    let eventReads = 0
    const app = createJudgeApi({
      credential: "test-credential",
      submit: async () => ({ kind: "accepted", runId: "run-1" }),
      cursorSecret: "secret",
      store: {
        loadRun: async () => undefined,
        loadEvents: async () => { eventReads++; return [] },
      } as never,
    })
    const response = await app.fetch(new Request("http://localhost/v1/judge/runs/unknown/events", { headers: { authorization: "Bearer test-credential" } }))
    expect(response.status).toBe(404)
    expect(eventReads).toBe(0)
  })

  test("event query for an existing run with no later events returns an empty page", async () => {
    const app = createJudgeApi({
      credential: "test-credential",
      submit: async () => ({ kind: "accepted", runId: "run-1" }),
      cursorSecret: "secret",
      store: {
        loadRun: async () => ({ runId: "run-1", state: "completed", stateVersion: 2 }),
        loadEvents: async () => [],
      } as never,
    })
    const response = await app.fetch(new Request("http://localhost/v1/judge/runs/run-1/events", { headers: { authorization: "Bearer test-credential" } }))
    expect(await response.json()).toEqual({ events: [], nextCursor: null })
  })

  test("cancellation request is routed to durable cancellation port and is idempotent", async () => {
    const calls: string[] = []
    const app = createJudgeApi({
      credential: "test-credential",
      submit: async () => ({ kind: "accepted", runId: "run-1" }),
      store: {
        requestCancellation: async (runId: string) => {
          calls.push(runId)
          return calls.length === 1 ? { kind: "cancelled" } : { kind: "already_cancelled" }
        },
      } as never,
    })
    const headers = { authorization: "Bearer test-credential" }
    const first = await app.fetch(new Request("http://localhost/v1/judge/runs/run-1/cancel", { method: "POST", headers }))
    const again = await app.fetch(new Request("http://localhost/v1/judge/runs/run-1/cancel", { method: "POST", headers }))
    expect(first.status).toBe(202)
    expect(again.status).toBe(200)
    expect(await first.json()).toEqual({ runId: "run-1", cancellation: "requested" })
    expect(await again.json()).toEqual({ runId: "run-1", cancellation: "already_requested" })
    expect(calls).toEqual(["run-1", "run-1"])
  })

  test("rejects cancellation of unknown and already-terminal runs", async () => {
    const app = createJudgeApi({
      credential: "test-credential",
      submit: async () => ({ kind: "accepted", runId: "run-1" }),
      store: {
        requestCancellation: async (runId: string) => runId === "missing" ? { kind: "not_found" } : { kind: "terminal" },
      } as never,
    })
    const headers = { authorization: "Bearer test-credential" }
    expect((await app.fetch(new Request("http://localhost/v1/judge/runs/missing/cancel", { method: "POST", headers }))).status).toBe(404)
    expect((await app.fetch(new Request("http://localhost/v1/judge/runs/completed/cancel", { method: "POST", headers }))).status).toBe(409)
  })
})
