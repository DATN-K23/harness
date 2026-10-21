// Adapted from OpenCode packages/server/src/index.ts @ 3f393d78bf (MIT License). See NOTICE.
import { JudgeSubmitRequestSchema, type JudgeSubmitRequest } from "@harness/protocol"
import { createHmac, timingSafeEqual } from "node:crypto"
import { isAuthorizedLocalRequest } from "./runtime-security"
import { ApiCompatibility } from "./runtime-security"

type StoredRun = Awaited<ReturnType<NonNullable<import("@harness/protocol").RunStorePort["loadRun"]>>>
type StoredEvent = import("@harness/protocol").TrajectoryEvent

export interface JudgeSubmissionService {
  submit(input: JudgeSubmitRequest & { idempotencyKey: string }): Promise<{ kind: "accepted" | "replayed"; runId: string } | { kind: "conflict" } | { kind: "not_found"; resource: "snapshot" }>
}

export interface JudgeQueryStore {
  loadRun(runId: string): Promise<StoredRun>
  loadEvents(input: { runId: string; afterSequence?: number }): Promise<StoredEvent[]>
  requestCancellation?(runId: string): Promise<{ kind: "cancelled" | "already_cancelled" | "terminal" | "not_found" }>
}

interface EventCursor {
  version: 1
  runId: string
  afterSequence: number
  pageSize: number
}

const encodeCursor = (cursor: EventCursor, secret: string) => {
  const payload = Buffer.from(JSON.stringify(cursor)).toString("base64url")
  const signature = createHmac("sha256", secret).update(payload).digest("base64url")
  return `${payload}.${signature}`
}

const decodeCursor = (value: string, secret: string): EventCursor | undefined => {
  const [payload, signature, extra] = value.split(".")
  if (!payload || !signature || extra !== undefined) return undefined
  const expected = createHmac("sha256", secret).update(payload).digest()
  let actual: Buffer
  try {
    actual = Buffer.from(signature, "base64url")
  } catch {
    return undefined
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as EventCursor
    if (parsed.version !== 1 || typeof parsed.runId !== "string" || !Number.isSafeInteger(parsed.afterSequence) || parsed.afterSequence < 0)
      return undefined
    if (!Number.isInteger(parsed.pageSize) || parsed.pageSize < 1 || parsed.pageSize > 100) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export const createJudgeApi = (deps: {
  submit: JudgeSubmissionService["submit"]
  store?: JudgeQueryStore
  cursorSecret?: string
  credential: string
}) => ({
  async fetch(request: Request): Promise<Response> {
    if (!isAuthorizedLocalRequest(request, deps.credential))
      return Response.json({ error: { code: "unauthorized", message: "Authentication required" } }, { status: 401 })
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/v1/health") {
      return Response.json({
        endpointId: "harness-local-runtime",
        apiVersion: ApiCompatibility.apiVersion,
        contractDigest: ApiCompatibility.contractDigest,
        buildVersion: String(process.env.HARNESS_BUILD_VERSION ?? "1"),
        capabilities: ["judge-submit", "run-query", "event-poll", "cancellation"],
      })
    }
    const runMatch = /^\/v1\/judge\/runs\/([^/]+)(?:\/(events))?$/.exec(url.pathname)
    const cancelMatch = /^\/v1\/judge\/runs\/([^/]+)\/cancel$/.exec(url.pathname)
    if (request.method === "POST" && cancelMatch) {
      if (!deps.store?.requestCancellation)
        return Response.json({ error: { code: "unavailable", message: "Run cancellation is unavailable" } }, { status: 503 })
      const result = await deps.store.requestCancellation(decodeURIComponent(cancelMatch[1]))
      if (result.kind === "not_found") return Response.json({ error: { code: "not_found", message: "Run not found" } }, { status: 404 })
      if (result.kind === "terminal") return Response.json({ error: { code: "conflict", message: "Run is already terminal" } }, { status: 409 })
      if (result.kind === "already_cancelled") return Response.json({ runId: decodeURIComponent(cancelMatch[1]), cancellation: "already_requested" })
      return Response.json({ runId: decodeURIComponent(cancelMatch[1]), cancellation: "requested" }, { status: 202 })
    }
    if (request.method === "GET" && runMatch) {
      if (!deps.store) return Response.json({ error: { code: "unavailable", message: "Run queries are unavailable" } }, { status: 503 })
      const runId = decodeURIComponent(runMatch[1])
      if (runMatch[2] === "events") {
        if (!deps.cursorSecret) return Response.json({ error: { code: "unavailable", message: "Event cursor signing is unavailable" } }, { status: 503 })
        const suppliedCursor = url.searchParams.get("cursor")
        const rawLimit = url.searchParams.get("limit")
        const requestedLimit = rawLimit === null ? 50 : Number(rawLimit)
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100)
          return Response.json({ error: { code: "invalid_request", message: "Event limit must be between 1 and 100" } }, { status: 400 })
        let afterSequence = 0
        let pageSize = requestedLimit
        if (suppliedCursor) {
          const cursor = decodeCursor(suppliedCursor, deps.cursorSecret)
          if (!cursor || cursor.runId !== runId || (rawLimit !== null && requestedLimit !== cursor.pageSize))
            return Response.json({ error: { code: "invalid_cursor", message: "Event cursor is invalid for this run" } }, { status: 400 })
          afterSequence = cursor.afterSequence
          pageSize = cursor.pageSize
        }
        const run = await deps.store.loadRun(runId)
        if (!run) return Response.json({ error: { code: "not_found", message: "Run not found" } }, { status: 404 })
        const events = await deps.store.loadEvents({ runId, afterSequence })
        const page = events.slice(0, pageSize)
        const hasMore = events.length > page.length
        const nextCursor = hasMore && page.length > 0
          ? encodeCursor({ version: 1, runId, afterSequence: page.at(-1)!.sequence, pageSize }, deps.cursorSecret)
          : null
        return Response.json({ events: page, nextCursor })
      }
      const run = await deps.store.loadRun(runId)
      if (!run) return Response.json({ error: { code: "not_found", message: "Run not found" } }, { status: 404 })
      return Response.json({
        runId: run.runId,
        state: run.state,
        stateVersion: run.stateVersion,
        ...(run.terminalReason === undefined ? {} : { terminalReason: run.terminalReason }),
        ...(run.snapshotId === undefined ? {} : { snapshotId: run.snapshotId }),
        ...(run.findingId === undefined ? {} : { findingId: run.findingId }),
        ...(run.resultContent === undefined || run.state !== "completed" ? {} : { resultContent: run.resultContent }),
        ...(run.errorMessage === undefined ? {} : { errorMessage: run.errorMessage }),
      })
    }
    if (request.method !== "POST" || url.pathname !== "/v1/judge/runs")
      return Response.json({ error: { code: "not_found", message: "Route not found" } }, { status: 404 })

    const idempotencyKey = request.headers.get("idempotency-key")?.trim()
    if (!idempotencyKey || idempotencyKey.length > 256)
      return Response.json({ error: { code: "invalid_request", message: "A valid Idempotency-Key header is required" } }, { status: 400 })

    const contentLength = Number(request.headers.get("content-length") ?? 0)
    if (contentLength > 256_000)
      return Response.json({ error: { code: "invalid_request", message: "Request body exceeds the size limit" } }, { status: 413 })

    let body: unknown
    try {
      const text = await request.text()
      if (new TextEncoder().encode(text).byteLength > 256_000)
        return Response.json({ error: { code: "invalid_request", message: "Request body exceeds the size limit" } }, { status: 413 })
      body = JSON.parse(text)
    } catch {
      return Response.json({ error: { code: "invalid_request", message: "Request body must be valid JSON" } }, { status: 400 })
    }

    const parsed = JudgeSubmitRequestSchema.safeParse(body)
    if (!parsed.success)
      return Response.json({ error: { code: "invalid_request", message: "Request does not match the Judge submission contract" } }, { status: 400 })

    let result: Awaited<ReturnType<JudgeSubmissionService["submit"]>>
    try {
      result = await deps.submit({ ...parsed.data, idempotencyKey })
    } catch {
      return Response.json({ error: { code: "execution_error", message: "Unable to accept Judge run" } }, { status: 503 })
    }
    if (result.kind === "conflict")
      return Response.json({ error: { code: "idempotency_conflict", message: "Idempotency key was used for a different request" } }, { status: 409 })
    if (result.kind === "not_found")
      return Response.json({ error: { code: "not_found", message: "Source snapshot not found" } }, { status: 404 })

    const statusUrl = `/v1/judge/runs/${encodeURIComponent(result.runId)}`
    return Response.json(
      { runId: result.runId, state: "accepted", statusUrl },
      { status: 202, headers: { location: statusUrl } },
    )
  },
})
