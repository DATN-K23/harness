import { JudgeSubmitRequestSchema, type JudgeSubmitRequest } from "@harness/protocol"

export interface JudgeSubmissionService {
  submit(input: JudgeSubmitRequest & { idempotencyKey: string }): Promise<{ kind: "accepted" | "replayed"; runId: string } | { kind: "conflict" } | { kind: "not_found"; resource: "snapshot" }>
}

export const createJudgeApi = (deps: { submit: JudgeSubmissionService["submit"] }) => ({
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
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
