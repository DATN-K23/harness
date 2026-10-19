import { describe, expect, test } from "bun:test"
import type { ModelAttemptRequest, ToolDefinition } from "@harness/protocol"
import { RealModelGateway } from "../src"
import { readRecordingFixture, RecordingClient } from "./support/recording-client"

const request = (overrides: Partial<ModelAttemptRequest> = {}): ModelAttemptRequest => ({
  runId: "recorded-run",
  stepIndex: 1,
  attemptIndex: 0,
  profileId: "gpt-4o-mini",
  items: [
    {
      id: "prompt",
      turn: 0,
      type: "candidate_finding",
      isPinned: true,
      content: "Inspect the contract.",
    },
  ],
  ...overrides,
})

const expectCapturedRequest = (recording: RecordingClient) => {
  expect(recording.callCount).toBeGreaterThan(0)
  expect(recording.requests[0]?.model).toBe("gpt-4o-mini")
}

const tools: ToolDefinition[] = [
  { name: "read_file", description: "Read a snapshot file.", parameters: { type: "object", properties: { path: { type: "string" } } } },
  { name: "grep", description: "Search snapshot files.", parameters: { type: "object", properties: { pattern: { type: "string" } } } },
]

describe("recorded provider outcomes", () => {
  test("tool call then answer replays matched history and sends tool definitions", async () => {
    const recording = new RecordingClient(readRecordingFixture("tool-call-then-answer"))
    const gateway = new RealModelGateway({ client: recording.client })
    const first = await gateway.executeAttempt(request({ tools, maxToolCalls: 3 }))
    expect(recording.callCount).toBe(1)
    expectCapturedRequest(recording)
    expect(first.finishReason).toBe("tool_calls")
    expect(first.toolCalls?.[0]).toMatchObject({ id: "call-read-1", name: "read_file", arguments: { path: "src/Vault.sol" } })
    expect(recording.requests[0]?.tool_choice).toBe("auto")
    expect(recording.requests[0]?.tools).toMatchObject([
      { type: "function", function: { name: "read_file", description: "Read a snapshot file.", parameters: { type: "object" } } },
      { type: "function", function: { name: "grep", description: "Search snapshot files.", parameters: { type: "object" } } },
    ])

    const second = await gateway.executeAttempt(request({
      tools,
      items: [
        { id: "prompt", turn: 0, type: "candidate_finding", isPinned: true, content: "Inspect the contract." },
        { id: "reasoning", turn: 1, type: "assistant_reasoning", isPinned: false, content: "I will inspect the source." },
        { id: "request", turn: 1, type: "tool_request", isPinned: false, content: "{\"path\":\"src/Vault.sol\"}", toolMeta: { callId: "call-read-1", toolName: "read_file" } },
        { id: "result", turn: 1, type: "tool_result", isPinned: false, content: "contract Vault {}", toolMeta: { callId: "call-read-1", toolName: "read_file" } },
      ],
    }))
    expect(recording.callCount).toBe(2)
    expect(second.finishReason).toBe("stop")
    expect(second.content).toContain("checks-effects-interactions")
    expect(recording.requests[1]?.messages).toContainEqual({
      role: "assistant",
      content: "I will inspect the source.",
      tool_calls: [{ id: "call-read-1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"src/Vault.sol\"}" } }],
    })
    expect(recording.requests[1]?.messages).toContainEqual({ role: "tool", tool_call_id: "call-read-1", content: "contract Vault {}" })
  })

  test("parallel tool calls remain together in one assistant response", async () => {
    const recording = new RecordingClient(readRecordingFixture("parallel-tool-calls"))
    const gateway = new RealModelGateway({ client: recording.client })
    const response = await gateway.executeAttempt(request({ tools, maxToolCalls: 4 }))
    expectCapturedRequest(recording)
    expect(response.finishReason).toBe("tool_calls")
    expect(response.toolCalls?.map((call) => call.id)).toEqual(["call-read-1", "call-grep-2"])
    expect(recording.requests[0]?.parallel_tool_calls).toBeUndefined()
  })

  test("malformed arguments are flagged and full-tier sanitized", async () => {
    const recording = new RecordingClient(readRecordingFixture("malformed-arguments"))
    const gateway = new RealModelGateway({ client: recording.client })
    const response = await gateway.executeAttempt(request({ tools }))
    const call = response.toolCalls?.[0]
    expectCapturedRequest(recording)
    expect(response.finishReason).toBe("tool_calls")
    expect(call?.arguments).toEqual({})
    expect(call?.argumentsError).toBeTruthy()
    expect(call?.rawArguments).toBe('{"path":"<absolute path redacted>"')
  })

  test("length drops a truncated tool call", async () => {
    const recording = new RecordingClient(readRecordingFixture("length-during-tool-call"))
    const gateway = new RealModelGateway({ client: recording.client })
    const response = await gateway.executeAttempt(request({ tools }))
    expectCapturedRequest(recording)
    expect(response.finishReason).toBe("length")
    expect(response.toolCalls).toBeUndefined()
  })

  test("content-filter finish is a typed invalid-request error", async () => {
    const recording = new RecordingClient(readRecordingFixture("content-filter"))
    const response = await new RealModelGateway({ client: recording.client }).executeAttempt(request())
    expectCapturedRequest(recording)
    expect(response.finishReason).toBe("error")
    expect(response.error).toMatchObject({ category: "invalid_request", classification: "content_filter" })
  })

  test("401 is sanitized and non-retryable", async () => {
    const recording = new RecordingClient(readRecordingFixture("auth-401"))
    const response = await new RealModelGateway({ client: recording.client }).executeAttempt(request())
    expectCapturedRequest(recording)
    expect(response.finishReason).toBe("error")
    expect(response.error).toMatchObject({ category: "authentication", isRetryable: false, statusCode: 401 })
    expect(response.error?.message).not.toContain("sk-test-secret")
  })

  test("429 preserves Retry-After and is not context overflow", async () => {
    const recording = new RecordingClient(readRecordingFixture("rate-limit-429-with-retry-after"))
    const response = await new RealModelGateway({ client: recording.client }).executeAttempt(request())
    expectCapturedRequest(recording)
    expect(response.error).toMatchObject({ category: "rate_limit", isRetryable: true, statusCode: 429, retryAfterMs: 2500 })
    expect(response.error?.classification).toBeUndefined()
  })

  test("500 maps to retryable transport failure", async () => {
    const recording = new RecordingClient(readRecordingFixture("server-500"))
    const response = await new RealModelGateway({ client: recording.client }).executeAttempt(request())
    expectCapturedRequest(recording)
    expect(response.error).toMatchObject({ category: "transport", isRetryable: true, statusCode: 500 })
  })

  test("400 context overflow keeps invalid-request category and adds classification", async () => {
    const recording = new RecordingClient(readRecordingFixture("context-overflow-400"))
    const response = await new RealModelGateway({ client: recording.client }).executeAttempt(request())
    expectCapturedRequest(recording)
    expect(response.error).toMatchObject({
      category: "invalid_request",
      isRetryable: false,
      statusCode: 400,
      classification: "context_overflow",
    })
  })

  test("timeout resolves as a transport error", async () => {
    const recording = new RecordingClient(readRecordingFixture("timeout"))
    const response = await new RealModelGateway({ client: recording.client, timeoutMs: 5 }).executeAttempt(request())
    expect(recording.callCount).toBe(1)
    expectCapturedRequest(recording)
    expect(response.finishReason).toBe("error")
    expect(response.error).toMatchObject({ category: "transport", isRetryable: true, isTimeout: true })
  })
})
