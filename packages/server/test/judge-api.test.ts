import { describe, expect, test } from "bun:test"
import { createJudgeApi } from "../src/judge-api"

describe("Judge submission API", () => {
  test("returns 202 only after durable submit has accepted finding and snapshot", async () => {
    let accepted = false
    const app = createJudgeApi({
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
      headers: { "content-type": "application/json", "idempotency-key": "key-1" },
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

  test("rejects invalid payload and unresolved snapshot before durable admission", async () => {
    let calls = 0
    const app = createJudgeApi({
      submit: async () => {
        calls++
        return { kind: "accepted", runId: "unexpected" }
      },
    })
    const response = await app.fetch(new Request("http://localhost/v1/judge/runs", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "key-1" },
      body: JSON.stringify({ finding: { findingId: "", reportMarkdown: "" }, snapshotId: "missing" }),
    }))
    expect(response.status).toBe(400)
    expect(calls).toBe(0)
  })

  test("returns conflict without issuing a run when idempotency digest differs", async () => {
    const app = createJudgeApi({ submit: async () => ({ kind: "conflict" }) })
    const response = await app.fetch(new Request("http://localhost/v1/judge/runs", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "key-1" },
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
    const app = createJudgeApi({ submit: async () => { calls++; return { kind: "accepted", runId: "run-1" } } })
    const headers = { "content-type": "application/json", "idempotency-key": "key-1" }
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
    const app = createJudgeApi({ submit: async () => { throw new Error("database unavailable") } })
    const response = await app.fetch(new Request("http://localhost/v1/judge/runs", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "key-1" },
      body: JSON.stringify({ finding: { findingId: "finding-1", reportMarkdown: "Report" }, snapshotId: "snapshot-1" }),
    }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: { code: "execution_error", message: "Unable to accept Judge run" } })
  })
})
