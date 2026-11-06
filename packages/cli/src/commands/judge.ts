import { randomUUID } from "node:crypto"
import { claimMarkdown } from "@harness/core"
import { JudgeSubmitRequestSchema, RunStates, TerminalRunStates } from "@harness/protocol"
import { assertApiCompatibility, localAuthorization, requireLocalServerPassword } from "@harness/server"
import { ensureSharedServer, loopbackOrigin } from "../shared-server"

const RunId = /^[A-Za-z0-9_-]{1,128}$/

export const judgeViaServer = async (
  options: { snapshot?: string; finding?: string; server?: string },
  env: Record<string, string | undefined>,
  stdout: (message: string) => void,
  signal: AbortSignal,
  deps: { fetch(url: string, init?: RequestInit): Promise<Response>; ensureSharedServer: typeof ensureSharedServer } = { fetch, ensureSharedServer },
) => {
  if (!options.snapshot || !options.finding) throw new Error("judge requires --snapshot and --finding")
  const file = Bun.file(options.finding)
  if (!(await file.exists()) || file.size > 256_000) throw new Error("Finding file is missing or exceeds 256 KB")
  const reportMarkdown = claimMarkdown(await file.text())
  const parsed = JudgeSubmitRequestSchema.safeParse({
    snapshotId: options.snapshot,
    finding: { findingId: `finding-${randomUUID()}`, reportMarkdown },
  })
  if (!parsed.success) throw new Error("Finding or snapshot ID does not match the Judge submission contract")

  const server = options.server === undefined ? await deps.ensureSharedServer(env, signal) : {
    origin: loopbackOrigin(options.server), password: requireLocalServerPassword(env.HARNESS_SERVER_PASSWORD),
  }
  const origin = server.origin
  const password = server.password
  const authorization = localAuthorization(password)
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await deps.fetch(origin + path, {
      ...init,
      headers: { ...init.headers, authorization },
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      redirect: "error",
    })
    if (response.status === 401) throw new Error("Local Judge server rejected the configured password")
    if (response.status === 503) throw new Error("Local Judge runtime unavailable (HTTP 503). Check database, provider and snapshot configuration")
    if (!response.ok) throw new Error(`Local Judge API returned HTTP ${response.status}`)
    return response.json()
  }

  const health = await request("/v1/health") as { endpointId?: string; apiVersion?: number }
  if (health?.endpointId !== "harness-local-runtime" || typeof health.apiVersion !== "number")
    throw new Error("Endpoint is not a Harness local Judge server")
  assertApiCompatibility({ apiVersion: health.apiVersion })
  const submitted = await request("/v1/judge/runs", {
    method: "POST", body: JSON.stringify(parsed.data),
    headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
  }) as { runId?: string }
  if (typeof submitted?.runId !== "string" || !RunId.test(submitted.runId))
    throw new Error("Local Judge API returned an invalid run ID")
  const { runId } = submitted
  stdout(`Run ID: ${runId}`)
  const polling = AbortSignal.timeout(10 * 60_000)
  while (!polling.aborted) {
    signal.throwIfAborted()
    const status = await request(`/v1/judge/runs/${runId}`) as {
      runId: string; state: (typeof RunStates)[number]; verdict?: { validity?: string; reasonCode?: string }
    }
    if (status?.runId !== runId || !RunStates.includes(status.state)) throw new Error("Invalid Judge run status")
    if (TerminalRunStates.some((state) => state === status.state)) {
      return {
        runId, state: status.state,
        ...(status.verdict?.validity === "valid" || status.verdict?.validity === "invalid" || status.verdict?.validity === "unverified"
          ? { validity: status.verdict.validity } : {}),
        ...(typeof status.verdict?.reasonCode === "string" && /^[A-Z0-9_]{1,80}$/.test(status.verdict.reasonCode)
          ? { reasonCode: status.verdict.reasonCode } : {}),
      }
    }
    await Bun.sleep(250)
  }
  throw new Error("Stopped waiting after 10 minutes. The admitted run is still in the store")
}
