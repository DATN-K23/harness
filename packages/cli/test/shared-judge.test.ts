import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createJudgeApi } from "@harness/server"
import { judgeViaServer } from "../src/commands/judge"
import { parseCliArgs } from "../src/index"

let directory: string
let finding: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "harness-shared-judge-"))
  finding = join(directory, "finding.md")
  await writeFile(finding, "# Candidate report\nA caller can withdraw from the Vault.")
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

test("Judge submits and polls through the shared authenticated API", async () => {
  const parsed = parseCliArgs(["judge", "--snapshot", "snapshot-1", "--finding", finding])
  const stdout: string[] = []
  let connections = 0
  let polls = 0
  const api = createJudgeApi({
    credential: "generated",
    submit: async (input) => {
      expect(input.snapshotId).toBe("snapshot-1")
      expect(input.finding.reportMarkdown).toContain("Vault")
      expect(input.idempotencyKey).toBeTruthy()
      return { kind: "accepted", runId: "run-test" }
    },
  })
  const result = await judgeViaServer(parsed, {}, (line) => stdout.push(line), new AbortController().signal, {
    async ensureSharedServer() {
      connections++
      return { origin: "http://127.0.0.1:4318", password: "generated" }
    },
    async fetch(url, init) {
      const request = new Request(url, init)
      expect(init?.redirect).toBe("error")
      if (new URL(url).pathname === "/v1/judge/runs/run-test") {
        const auth = await api.fetch(new Request("http://127.0.0.1/v1/health", { headers: request.headers }))
        expect(auth.status).toBe(200)
        polls++
        return Response.json({ runId: "run-test", state: polls === 1 ? "running" : "completed", verdict: { validity: "unverified" } })
      }
      return api.fetch(request)
    },
  })
  expect(result).toEqual({ runId: "run-test", state: "completed", validity: "unverified" })
  expect(stdout).toEqual(["Run ID: run-test"])
  expect(connections).toBe(1)
  expect(polls).toBe(2)
})

test("explicit attach skips daemon discovery and rejects nonlocal URLs", async () => {
  expect(() => parseCliArgs(["judge", "--mock", "--snapshot", "snap", "--finding", finding])).toThrow("--mock")
  const options = { snapshot: "snap", finding, server: "http://127.0.0.1:4318" }
  const signal = new AbortController().signal
  let requests = 0
  const deps = {
    ensureSharedServer: async (): Promise<never> => { throw new Error("should not discover") },
    async fetch(_url: string, init?: RequestInit) {
      requests++
      expect(new Headers(init?.headers).get("authorization")).toBe(`Basic ${btoa("harness:configured")}`)
      return new Response(null, { status: 401 })
    },
  }
  await expect(judgeViaServer(options, { HARNESS_SERVER_PASSWORD: "configured" }, () => {}, signal, deps)).rejects.toThrow("rejected")
  await expect(judgeViaServer({ ...options, server: "http://example.org" }, { HARNESS_SERVER_PASSWORD: "configured" }, () => {}, signal, deps))
    .rejects.toThrow("loopback origin")
  expect(requests).toBe(1)
})
